import type { ReactNode } from 'react';
import {
  JAM_PIECE_GLYPH,
  JAM_PIECE_NAME,
  PIECE_GLYPH,
  PIECE_NAME,
  type JamPieceType,
  type PieceType,
} from '../engine';
import { Modal } from './Modal';

const ENEMIES: PieceType[] = ['pawn', 'rook', 'bishop', 'knight', 'queen'];

const RULES: Record<PieceType, string> = {
  pawn: 'Шагает на одну клетку вниз и бьёт по диагонали вниз.',
  rook: 'Ходит по горизонтали и вертикали на любое расстояние.',
  bishop: 'Ходит по диагонали на любое расстояние.',
  knight: 'Прыгает буквой Г: две клетки в одну сторону и одна в другую.',
  queen: 'Сочетает ладью и слона. Появляется на пятнадцатом уровне.',
};

const JAM_PIECES: JamPieceType[] = ['rook', 'bishop', 'knight'];

const JAM_RULES: Record<JamPieceType, string> = {
  rook: 'По горизонтали и вертикали на любое расстояние, пока путь свободен.',
  bishop: 'По диагонали на любое расстояние, пока путь свободен.',
  knight: 'Буквой Г и перепрыгивает через соседей: единственная фигура, которой пробка не помеха.',
};

const WHEN: Record<PieceType, string> = {
  pawn: 'с 1',
  rook: 'с 3',
  bishop: 'с 5',
  knight: 'с 8',
  queen: 'с 15',
};

export function RulesModal({
  onClose,
  onTerms,
  onPrivacy,
  jam = false,
}: {
  onClose: () => void;
  onTerms: () => void;
  onPrivacy: () => void;
  /** Памятка для «Парковки»: там другие правила, без ходов пешки. */
  jam?: boolean;
}): ReactNode {
  return (
    <Modal onClose={onClose} showClose className="" labelledBy="rules-title">
      <span className="label">Памятка</span>
      <h2 className="modal-title" id="rules-title">
        Как играть
      </h2>
      <p className="modal-text">
        {jam
          ? 'Поле забито фигурами двух цветов. Ходите любой своей фигурой по её правилу и перегоняйте всех на чужую половину: белые наверх, чёрные вниз.'
          : 'Пешка идёт через доску снизу вверх. Фигуры ходят по шахматным правилам и стараются её поймать. Задача простая: довести пешку до верхнего ряда.'}
      </p>

      <ol className="rules-steps">
        {jam ? (
          <>
            <li>
              <span>1</span>
              <div>
                <b>Ход как в шахматах</b>
                <p>
                  Ладья ездит по прямым, слон по диагоналям, конь перепрыгивает через остальных. Встать
                  можно только на свободную клетку.
                </p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <b>Бить нельзя</b>
                <p>Фигуры не снимаются с доски вовсе: пробку приходится разводить объездом, и каждую лишнюю перестановку видно в бюджете.</p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <b>Считанные ходы</b>
                <p>
                  Дано столько перестановок, сколько нужно на решение плюс небольшой запас. Кончились
                  ходы - забег проигран, жизнь списана, уровень можно переиграть.
                </p>
              </div>
            </li>
          </>
        ) : (
          <>
            <li>
              <span>1</span>
              <div>
                <b>Только вперёд</b>
                <p>
                  Прямо, влево-вперёд или вправо-вперёд. Назад и вбок нельзя. Первый ход можно сделать на две
                  клетки, если промежуточная и целевая свободны.
                </p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <b>Фигуры можно бить</b>
                <p>
                  По диагонали вперёд пешка берёт фигуру, прямо на неё вставать нельзя. Если всех три клетки
                  закрыты, ход пропускается бесплатно; ещё два пропуска за забег доступны по своему желанию.
                </p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <b>Верхний ряд</b>
                <p>Любая клетка верхнего ряда приносит победу. В бесконечном режиме нужно подняться как можно выше.</p>
              </div>
            </li>
          </>
        )}
      </ol>

      <div className="rules-pieces">
        <div className="rules-pieces-head">
          <span>Фигуры</span>
          <span>{jam ? 'Как ходит' : 'Появляется'}</span>
        </div>
        {(jam ? JAM_PIECES : ENEMIES).map((type) => (
          <div className="rules-piece" key={type}>
            <span className={`rules-glyph rules-${type}`}>{jam ? JAM_PIECE_GLYPH[type as JamPieceType] : PIECE_GLYPH[type as PieceType]}</span>
            <div>
              <b>{jam ? JAM_PIECE_NAME[type as JamPieceType] : PIECE_NAME[type as PieceType]}</b>
              <p>{jam ? JAM_RULES[type as JamPieceType] : RULES[type as PieceType]}</p>
            </div>
            <span className="rules-when">{jam ? 'в пробке' : WHEN[type as PieceType]}</span>
          </div>
        ))}
      </div>

      <p className="rules-meta">
        Пять жизней, одна новая каждые 30 минут. Монеты дают за уровни и рекорды, а тратятся на
        подсказку, заморозку и отмену хода.
      </p>

      <button type="button" className="btn btn-primary btn-block" onClick={onClose}>
        Понятно
      </button>

      <div className="legal-link-row">
        <button type="button" onClick={onTerms}>Условия использования</button>
        <button type="button" onClick={onPrivacy}>Конфиденциальность</button>
      </div>
    </Modal>
  );
}
