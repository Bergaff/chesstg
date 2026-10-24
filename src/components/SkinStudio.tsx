import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  GLYPH_CHOICES,
  GRID,
  PRODUCTS,
  SKINS,
  TOKEN_KEYS,
  TOKEN_LABELS,
  checkSkin,
  decodeSkinCode,
  encodeSkinCode,
  pathFromFrame,
  skinReadability,
  skinTokens,
  skinVars,
  type CustomSkin,
  type TokenKey,
} from '../engine';
import { useApp } from '../context/AppContext';
import { api, ApiError } from '../lib/api';
import { cn } from '../lib/format';
import { hapticNotify } from '../lib/telegram';
import { Modal } from './Modal';
import { SkinPreview } from './SkinPreview';

/**
 * Студия темы: цвета доски, глиф или свой контур - и всё это бесплатно.
 *
 * Правило, из которого студия растёт: своё для себя ничего не стоит, платит
 * только тот, кто хочет, чтобы тему надели чужие. Поэтому здесь две разные
 * кнопки: «Надеть» (никогда не просит звёзды) и «Показать всем» (счёт на взнос
 * и очередь проверки). Плюс код темы - им можно поделиться в чате бесплатно,
 * потому что чужая доска от этого не меняется и проверять нечего.
 */
interface SkinStudioProps {
  onClose: () => void;
  /** Счёт на публикацию выставляет магазин: у него уже есть цикл оплаты. */
  onShare: (skin: CustomSkin) => Promise<boolean>;
}

export function SkinStudio({ onClose, onShare }: SkinStudioProps): ReactNode {
  const { profile, setProfile, toast } = useApp();
  const base = profile.customSkin ?? null;
  const [name, setName] = useState(base?.name ?? 'Своя тема');
  const [tokens, setTokens] = useState<Record<TokenKey, string>>(
    () => ({ ...skinTokens(SKINS.classic), ...(base?.tokens ?? {}) }),
  );
  const [glyph, setGlyph] = useState(base?.glyph ?? SKINS.classic.glyph);
  const [path, setPath] = useState<string | undefined>(base?.path);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'save' | 'share' | null>(null);
  const [notice, setNotice] = useState('');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  const skin = useMemo(() => ({ ...tokens, glyph, path }), [tokens, glyph, path]);
  const read = useMemo(() => skinReadability(skin), [skin]);
  const encoded = useMemo(() => encodeSkinCode({ name, tokens, glyph, ...(path ? { path } : {}) }), [name, tokens, glyph, path]);

  // Чистый холст при первом открытии: 64×64 - тот же размер, что у трассировки,
  // чтобы игрок рисовал ровно в том разрешении, которое потом станет контуром.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#ffffff';
  }, []);

  function pointOf(event: ReactPointerEvent<HTMLCanvasElement>): [number, number] {
    const canvas = event.currentTarget;
    const box = canvas.getBoundingClientRect();
    return [
      ((event.clientX - box.left) / box.width) * canvas.width,
      ((event.clientY - box.top) / box.height) * canvas.height,
    ];
  }

  function onDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const ctx = event.currentTarget.getContext('2d');
    if (!ctx) return;
    drawing.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const [x, y] = pointOf(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function onMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = event.currentTarget.getContext('2d');
    if (!ctx) return;
    const [x, y] = pointOf(event);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function onUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    drawing.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setPath(undefined);
    setNotice('');
  }

  function trace() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { willReadFrequently: true });
    if (!canvas || !ctx) return;
    const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = pathFromFrame({ data: frame.data, size: canvas.width }, 'alpha');
    if (!result.path) {
      setNotice(
        result.coverage < 0.02
          ? 'Слишком мало линий: нарисуй фигуру крупнее, на всю клетку.'
          : result.coverage > 0.92
            ? 'Залитый квадрат фигурой не читается: оставь между линиями пустое.'
            : 'Контур не получился: попробуй замкнутый силуэт.',
      );
      return;
    }
    setPath(result.path);
    setNotice(`Контур готов: залято ${Math.round(result.coverage * 100)}% клетки.`);
  }

  async function save() {
    if (busy) return;
    const check = checkSkin({ name, tokens, glyph, path });
    if (!check.ok) {
      toast(check.error ?? 'Тему не видно на доске', 'error');
      return;
    }
    setBusy('save');
    try {
      const response = await api<{ profile: typeof profile }>('/api/profile/skin-custom', {
        method: 'POST',
        body: { skin: check.skin },
      });
      setProfile(response.profile);
      hapticNotify('success');
      toast('Своя тема надета - бесплатно и навсегда', 'success');
      onClose();
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Сохранить не удалось', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function share() {
    if (busy) return;
    const check = checkSkin({ name, tokens, glyph, path });
    if (!check.ok) {
      toast(check.error ?? 'Тему не видно на доске', 'error');
      return;
    }
    setBusy('share');
    try {
      const paid = await onShare(check.skin);
      if (paid) toast('Взнос принят, тема в очереди на проверку', 'success');
    } finally {
      setBusy(null);
    }
  }

  function applyCode() {
    const decoded = decodeSkinCode(code);
    if (!decoded) {
      toast('Код не читается: проверь, что скопировал целиком, с «kd1:»', 'error');
      return;
    }
    setName(decoded.name);
    setTokens({ ...skinTokens(SKINS.classic), ...decoded.tokens });
    setGlyph(decoded.glyph);
    setPath(decoded.path);
    setCode('');
    setNotice('Тема из кода надета на превью - не забудь сохранить.');
  }

  return (
    <Modal onClose={onClose} showClose>
      <span className="label">Студия</span>
      <h2 className="modal-title">Своя тема поля</h2>
      <p className="modal-text">
        Для себя - бесплатно и навсегда. Показать тему чужим стоит {PRODUCTS.share.stars} звёзд: взнос
        оплачивает проверку заявки и отсекает поток «накидал за минуту».
      </p>

      <div className="studio-head">
        <SkinPreview skin={skin} cell={34} />
        <div className="studio-head-side">
          <label className="studio-field">
            <span className="label">Название</span>
            <input
              type="text"
              value={name}
              maxLength={24}
              onChange={(event) => setName(event.target.value)}
              placeholder="Своя тема"
            />
          </label>
          <p className={cn('studio-read', read.ok ? 'is-ok' : 'is-bad')}>
            {read.ok
              ? `Видно на доске: фигура ${read.glyph.toFixed(1)}:1, отделка ${read.board.toFixed(1)}:1`
              : `Не видно на доске: ${read.why}`}
          </p>
        </div>
      </div>

      <span className="label section-label">Цвета</span>
      <div className="studio-colors">
        {TOKEN_KEYS.map((key) => (
          <label className="studio-color" key={key}>
            <span>{TOKEN_LABELS[key]}</span>
            <input
              type="color"
              value={tokens[key] || '#000000'}
              onChange={(event) => setTokens((prev) => ({ ...prev, [key]: event.target.value.toLowerCase() }))}
            />
            <code>{tokens[key] || '—'}</code>
          </label>
        ))}
      </div>
      {tokens.plate ? (
        <button type="button" className="studio-quiet" onClick={() => setTokens((prev) => ({ ...prev, plate: '' }))}>
          Убрать плашку фигуры
        </button>
      ) : (
        <button type="button" className="studio-quiet" onClick={() => setTokens((prev) => ({ ...prev, plate: '#ded4bd' }))}>
          Добавить плашку фигуры
        </button>
      )}

      <span className="label section-label">Фигура</span>
      <div className="studio-glyphs" role="group" aria-label="Глиф фигуры">
        {GLYPH_CHOICES.map((choice) => (
          <button
            type="button"
            key={choice}
            className={cn('studio-glyph', !path && glyph === choice && 'active')}
            onClick={() => setGlyph(choice)}
          >
            {choice}
          </button>
        ))}
      </div>

      <div className="studio-draw">
        <canvas
          ref={canvasRef}
          width={GRID}
          height={GRID}
          className="studio-canvas"
          style={skinVars(skin) as CSSProperties}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
        <div className="studio-draw-side">
          <p className="modal-note">
            Нарисуй фигуру пальцем и нажми «В контур»: рисунок становится ровным краем, а не
            картинкой - мыло на клетке в 36 пикселей не читается вовсе.
          </p>
          <div className="studio-draw-actions">
            <button type="button" className="btn btn-outline" onClick={trace}>
              В контур
            </button>
            <button type="button" className="btn btn-quiet" onClick={clearCanvas}>
              Стереть
            </button>
          </div>
          {path && (
            <button type="button" className="studio-quiet" onClick={() => setPath(undefined)}>
              Вернуть глиф ({path.length} знаков контура)
            </button>
          )}
          {notice && <p className="studio-note">{notice}</p>}
        </div>
      </div>

      <span className="label section-label">Код темы</span>
      <p className="modal-note">
        Этим текстом можно поделиться в чате - бесплатно: чужая доска от этого не меняется.
      </p>
      <textarea className="studio-code" readOnly value={encoded} rows={3} onFocus={(e) => e.currentTarget.select()} />
      <div className="studio-code-row">
        <input
          type="text"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="Вставить код: kd1:..."
        />
        <button type="button" className="btn btn-quiet" onClick={applyCode} disabled={!code.trim()}>
          Применить
        </button>
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy !== null || !read.ok}>
          {busy === 'save' ? 'Надеваем' : 'Надеть бесплатно'}
        </button>
        <button type="button" className="btn btn-outline" onClick={() => void share()} disabled={busy !== null || !read.ok}>
          {busy === 'share' ? 'Выставляем счёт' : `Показать всем: ${PRODUCTS.share.stars}`}
        </button>
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          Позже
        </button>
      </div>
    </Modal>
  );
}
