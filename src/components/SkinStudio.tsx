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
  SKIN_CUSTOM_COINS,
  SKIN_CUSTOM_STARS,
  TOKEN_KEYS,
  TOKEN_LABELS,
  checkSkin,
  decodeSkinCode,
  encodeSkinCode,
  inkMask,
  maskCoverage,
  pathFromFrame,
  skinReadability,
  skinTokens,
  skinVars,
  strokesPath,
  type CustomSkin,
  type TokenKey,
} from '../engine';
import { useApp } from '../context/AppContext';
import { api, ApiError } from '../lib/api';
import { appBaseUrl, cn, formatNumber } from '../lib/format';
import { hapticNotify, shareContent } from '../lib/telegram';
import { Modal } from './Modal';
import { SkinPreview } from './SkinPreview';
import { tr, trf } from '../lib/i18n';

/**
 * Студия темы: цвета доски, глиф или свой контур.
 *
 * Рисовать бесплатно и всегда - иначе нельзя: код темы пересылают в чат, и за
 * превью спроса не бывает. Платит тот, кто надевает: право носить свою тему
 * стоит `SKIN_CUSTOM_STARS` звёзд (или `SKIN_CUSTOM_COINS` монет) и покупается
 * один раз на аккаунт. До этой цены своя тема была даром, и из-за этого полка
 * готовых тем пустовала: восемь цветов и контур всякий раз можно навести руками
 * за минуту. Второе правило - заливки нет: холст помнит штрихи, и в контур
 * уходит линия, а не залитая область (иначе круг с щелью становился диском).
 *
 * «Показать всем» - отдельный счёт на взнос: он оплачивает чужую работу,
 * проверку заявки, и к праву носить своё отношения не имеет.
 */
interface SkinStudioProps {
  onClose: () => void;
  /** Счёт на публикацию выставляет магазин: у него уже есть цикл оплаты. */
  onShare: (skin: CustomSkin) => Promise<boolean>;
  /** Открыть мастерскую: тот же цикл оплаты, что у звёздных товаров. */
  onUnlock: () => Promise<boolean>;
}

export function SkinStudio({ onClose, onShare, onUnlock }: SkinStudioProps): ReactNode {
  const { profile, config, setProfile, toast } = useApp();
  const base = profile.customSkin ?? null;
  const [name, setName] = useState(base?.name ?? tr('Своя тема'));
  const [tokens, setTokens] = useState<Record<TokenKey, string>>(
    () => ({ ...skinTokens(SKINS.classic), ...(base?.tokens ?? {}) }),
  );
  const [glyph, setGlyph] = useState(base?.glyph ?? SKINS.classic.glyph);
  const [path, setPath] = useState<string | undefined>(base?.path);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'save' | 'share' | 'unlock' | null>(null);
  const [notice, setNotice] = useState('');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  // Штрихи держим списком точек, а не только пикселями холста: из пикселей
  // обратно линию не собрать, остаётся силуэт, а силуэт заливает всё, что
  // ограничено контуром. Это и есть тот «круг стал диском», из-за которого
  // нарисованная пешка превращалась в пятнашку.
  const strokes = useRef<[number, number][][]>([]);

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
    // Толщина на холсте и толщина штриха в контуре - один масштаб (64 к 32),
    // иначе игрок видит одно, а на доске появляется другое.
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
    strokes.current = [...strokes.current, [[x, y]]];
  }

  function onMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = event.currentTarget.getContext('2d');
    if (!ctx) return;
    const [x, y] = pointOf(event);
    ctx.lineTo(x, y);
    ctx.stroke();
    const last = strokes.current[strokes.current.length - 1];
    if (last) strokes.current[strokes.current.length - 1] = [...last, [x, y]];
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
    strokes.current = [];
    setPath(undefined);
    setNotice('');
  }

  /**
   * «В контур»: штрихи холста становятся путём SVG. Пиксели нужны только как
   * мера - по ним судим, рисовал игрок фигуру или ткнул пальцем.
   */
  function trace() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { willReadFrequently: true });
    if (!canvas || !ctx) return;
    const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const coverage = maskCoverage(inkMask({ data: frame.data, size: canvas.width }, 'alpha'));
    if (coverage < 0.02) {
      setNotice(tr('Слишком мало линий: нарисуй фигуру крупнее, на всю клетку.'));
      return;
    }
    if (coverage > 0.92) {
      setNotice(tr('Залитый квадрат фигурой не читается: оставь между линиями пустое.'));
      return;
    }
    // Штрихов может и не быть - например, если код темы вставили, а рисование
    // начали поверх: тогда остаётся старый добрый силуэт.
    const path = strokes.current.length > 0 ? strokesPath(strokes.current, canvas.width) : pathFromFrame({ data: frame.data, size: canvas.width }, 'alpha').path;
    if (!path) {
      setNotice(tr('Контур не получился: проведи несколько длинных линий.'));
      return;
    }
    setPath(path);
    setNotice(trf('Контур готов: линии занимают {0}% клетки, {1} знаков.', [Math.round(coverage * 100), path.length]));
  }

  // Льгота `QA_LIVES_IDS` открывает мастерскую без счёта - как с темами полки.
  const unlocked = profile.qa || profile.customPaid;

  async function save() {
    if (busy) return;
    const check = checkSkin({ name, tokens, glyph, path });
    if (!check.ok) {
      toast(check.error ?? tr('Тему не видно на доске'), 'error');
      return;
    }
    if (!unlocked) {
      // Сначала право, потом сохранение: сервер бы и так ответил 402, но счёт
      // на звёзды выставит магазин - у него уже есть цикл оплаты и ожидания.
      setBusy('unlock');
      const granted = await onUnlock().catch(() => false);
      setBusy(null);
      if (!granted) return;
      toast(tr('Мастерская открыта, надеваем тему'), 'success');
    }
    setBusy('save');
    try {
      const response = await api<{ profile: typeof profile }>('/api/profile/skin-custom', {
        method: 'POST',
        body: { skin: check.skin },
      });
      setProfile(response.profile);
      hapticNotify('success');
      toast(unlocked ? tr('Своя тема надета') : tr('Своя тема надета - мастерская открыта навсегда'), 'success');
      onClose();
    } catch (error) {
      toast(error instanceof ApiError ? error.message : tr('Сохранить не удалось'), 'error');
    } finally {
      setBusy(null);
    }
  }

  /**
   * Код темы: его вставляют в поле «Вставить код», поэтому копируем целиком, без
   * «поделиться». Clipboard API в WebApp есть не всегда - тогда выделяем код в
   * служебном поле и просим браузер скопировать его; если и это молча
   * не работает, подсказываем, как скопировать руками.
   */
  async function copyCode() {
    const text = trf('Код темы «{0}» для «Край доски»:\n{1}', [name, encoded]);
    try {
      await navigator.clipboard.writeText(text);
      toast(tr('Код скопирован'), 'success');
      return;
    } catch {
      /* старый WebView без clipboard - пробуем через выделение */
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    area.remove();
    toast(copied ? tr('Код скопирован') : tr('Скопируйте код из поля вручную'), copied ? 'success' : 'info');
  }

  /**
   * Поделиться в Telegram: открывается готовое сообщение, где код уже вшит в
   * текст, а ссылкой идёт игра. Никаких «скопируйте вручную» - у принявшего
   * тема встанет в поле «Вставить код» целиком.
   */
  async function shareCode() {
    const status = await shareContent(
      trf('Код темы «{0}» для «Край доски» - вставь в студии:\n```\n{1}\n```', [name, encoded]),
      appBaseUrl(config.webappUrl),
    );
    if (status === 'copied') toast(tr('Код скопирован - вставь в чат сам'), 'success');
    if (status === 'failed') toast(tr('Не удалось открыть чат'), 'error');
  }

  async function share() {
    if (busy) return;
    const check = checkSkin({ name, tokens, glyph, path });
    if (!check.ok) {
      toast(check.error ?? tr('Тему не видно на доске'), 'error');
      return;
    }
    setBusy('share');
    try {
      const paid = await onShare(check.skin);
      // Для льготного аккаунта взноса не было - не о чём и благодарить.
      if (paid) toast(profile.qa ? tr('Тема в очереди на проверку') : tr('Взнос принят, тема в очереди на проверку'), 'success');
    } finally {
      setBusy(null);
    }
  }

  function applyCode() {
    const decoded = decodeSkinCode(code);
    if (!decoded) {
      toast(tr('Код не читается: проверь, что скопировал целиком, с «kd1:»'), 'error');
      return;
    }
    setName(decoded.name);
    setTokens({ ...skinTokens(SKINS.classic), ...decoded.tokens });
    setGlyph(decoded.glyph);
    setPath(decoded.path);
    setCode('');
    setNotice(tr('Тема из кода надета на превью - не забудь сохранить.'));
  }

  return (
    <Modal onClose={onClose} showClose>
      <span className="label">{tr('Студия')}</span>
      <h2 className="modal-title">{tr('Своя тема поля')}</h2>
      <p className="modal-text">
        {tr('Рисовать, красить превью и передавать код - бесплатно и без границ. Платит тот, кто надевает:')}{' '}
        {unlocked
          ? tr('ваша мастерская уже открыта, правки ничего не стоят.')
          : trf(
              'мастерская стоит {0} звёзд или {1} монет, один раз на аккаунт.',
              [SKIN_CUSTOM_STARS, formatNumber(SKIN_CUSTOM_COINS)],
            )}{' '}
        {trf(
          'Показать тему чужим стоит ещё {0} звёзд: взнос оплачивает проверку заявки и отсекает поток «накидал за минуту».',
          [PRODUCTS.share.stars],
        )}
      </p>

      <div className="studio-head">
        <SkinPreview skin={skin} cell={34} />
        <div className="studio-head-side">
          <label className="studio-field">
            <span className="label">{tr('Название')}</span>
            <input
              type="text"
              value={name}
              maxLength={24}
              onChange={(event) => setName(event.target.value)}
              placeholder={tr('Своя тема')}
            />
          </label>
          <p className={cn('studio-read', read.ok ? 'is-ok' : 'is-bad')}>
            {read.ok
              ? trf('Видно на доске: фигура {0}:1, отделка {1}:1', [read.glyph.toFixed(1), read.board.toFixed(1)])
              : trf('Не видно на доске: {0}', [read.why])}
          </p>
        </div>
      </div>

      <span className="label section-label">{tr('Цвета')}</span>
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
          {tr('Убрать плашку фигуры')}
        </button>
      ) : (
        <button type="button" className="studio-quiet" onClick={() => setTokens((prev) => ({ ...prev, plate: '#ded4bd' }))}>
          {tr('Добавить плашку фигуры')}
        </button>
      )}

      <span className="label section-label">{tr('Фигура')}</span>
      <div className="studio-glyphs" role="group" aria-label={tr('Глиф фигуры')}>
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
            {tr('Нарисуй фигуру пальцем и нажми «В контур»: каждый штрих станет ровной линией, а не заливкой - замкнёшь круг, и внутри останется пусто. Мыло на клетке в 36 пикселей не читается вовсе, поэтому контур, а не картинка.')}
          </p>
          <div className="studio-draw-actions">
            <button type="button" className="btn btn-outline" onClick={trace}>
              {tr('В контур')}
            </button>
            <button type="button" className="btn btn-quiet" onClick={clearCanvas}>
              {tr('Стереть')}
            </button>
          </div>
          {path && (
            <button type="button" className="studio-quiet" onClick={() => setPath(undefined)}>
              {trf('Вернуть глиф ({0} знаков контура)', [formatNumber(path.length)])}
            </button>
          )}
          {notice && <p className="studio-note">{notice}</p>}
        </div>
      </div>

      <span className="label section-label">{tr('Код темы')}</span>
      <p className="modal-note">
        {tr('Этим текстом делятся в чате бесплатно: чужая доска от него не меняется, а вставивший получает тему к себе. Надеть её он сможет со своей мастерской.')}
      </p>
      <textarea className="studio-code" readOnly value={encoded} rows={3} onFocus={(e) => e.currentTarget.select()} />
      <div className="studio-code-actions">
        <button type="button" className="btn btn-quiet" onClick={() => void copyCode()}>
          {tr('Скопировать код')}
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => void shareCode()}>
          {tr('Поделиться в Telegram')}
        </button>
        <span className="studio-code-size">{formatNumber(encoded.length)} {tr('знаков')}</span>
      </div>
      <div className="studio-code-row">
        <input
          type="text"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder={tr('Вставить код: kd1:...')}
        />
        <button type="button" className="btn btn-quiet" onClick={applyCode} disabled={!code.trim()}>
          {tr('Применить')}
        </button>
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy !== null || !read.ok}>
          {busy === 'save'
            ? tr('Надеваем')
            : busy === 'unlock'
              ? tr('Открываем мастерскую')
              : unlocked
                ? tr('Надеть')
                : trf('Открыть мастерскую: {0}', [SKIN_CUSTOM_STARS])}
        </button>
        <button type="button" className="btn btn-outline" onClick={() => void share()} disabled={busy !== null || !read.ok}>
          {busy === 'share'
            ? profile.qa
              ? tr('Отправляем')
              : tr('Выставляем счёт')
            : profile.qa
              ? tr('Показать всем')
              : trf('Показать всем: {0}', [PRODUCTS.share.stars])}
        </button>
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          {tr('Позже')}
        </button>
      </div>
    </Modal>
  );
}
