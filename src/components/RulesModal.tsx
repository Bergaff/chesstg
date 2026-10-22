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

/** В «Гонках» пул свой: номер волны решает, какая фигура приходит. */
const RACE_POOL: PieceType[] = ['rook', 'bishop', 'knight', 'queen'];

const RACE_WHEN: Partial<Record<PieceType, string>> = {
  rook: 'с 1 волны',
  bishop: 'с 1 волны',
  knight: 'с 1 волны',
  queen: 'с 4 волны',
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
  race = false,
}: {
  onClose: () => void;
  onTerms: () => void;
  onPrivacy: () => void;
  /** Памятка для «Парковки»: там другие правила, без ходов пешки. */
  jam?: boolean;
  /** Памятка для «Гонок»: игрок там король, а не пешка, и финиша нет. */
  race?: boolean;
}): ReactNode {
  return (
    <Modal onClose={onClose} showClose className="" labelledBy="rules-title">
      <span className="label">Памятка</span>
      <h2 className="modal-title" id="rules-title">
        Как играть
      </h2>
      <p className="modal-text">
        {jam
          ? 'Поле забито фигурами двух цветов. Ходите любой фигурой по её правилу и уводите всех с поля: белые за нижний край, чёрные за верхний.'
          : race
            ? 'Вы играете королём: один шаг в любую сторону и взятие любой фигуры. Фигуры выходят из двух верхних рядов и ходят по своим шахматным правилам, финиша нет: считается, сколько ходов вы пережили.'
            : 'Пешка идёт через доску снизу вверх. Фигуры ходят по шахматным правилам и стараются её поймать. Задача простая: довести пешку до верхнего ряда.'}
      </p>

      <ol className="rules-steps">
        {race ? (
          <>
            <li>
              <span>1</span>
              <div>
                <b>Король, а не пешка</b>
                <p>
                  Шаг на любую соседнюю клетку, назад и вбок тоже. На фигуре король её берёт, лимита
                  взятий нет: снимать фигуры это единственный способ дышать.
                </p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <b>Линия бьёт</b>
                <p>
                  Ладье и ферзю нужны ряд или колонка, поэтому шаг в сторону сбивает прицел. Конь и слон
                  бьют точечно, и щитом их не закрыть. Фигура не встанет на клетку короля прямо с края:
                  первый ход после её рождения всегда в пользу игрока.
                </p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <b>Считаются ходы</b>
                <p>
                  Приток ускоряется волнами: каждые двенадцать пережитых ходов волна растёт, на столько же
                  поднимается уровень режима. Рекорд длины забега виден в меню и в таблице рекордов,
                  монеты идут за сам забег, но только когда короля поймали.
                </p>
              </div>
            </li>
          </>
        ) : jam ? (

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
                <p>Чужую фигуру нельзя съесть вовсе: пробку разводят объездом, и каждую лишнюю перестановку видно в бюджете.</p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <b>Полоса ухода</b>
                <p>
                  Клетка за краем это выход: ладья съезжает к своему краю по колонке, слон доезжает по
                  диагонали, конь перепрыгивает строку. Увести нужно всех, на поле не должно остаться ни
                  одной фигуры. Ходов дано столько, сколько нужно плану решателя, плюс запас; кончились
                  ходы - забег проигран, жизнь списана, уровень тот же.
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
          <span>{jam ? 'Как ходит' : race ? 'Волна' : 'Появляется'}</span>
        </div>
        {(jam ? JAM_PIECES : race ? RACE_POOL : ENEMIES).map((type) => (
          <div className="rules-piece" key={type}>
            <span className={`rules-glyph rules-${type}`}>{jam ? JAM_PIECE_GLYPH[type as JamPieceType] : PIECE_GLYPH[type as PieceType]}</span>
            <div>
              <b>{jam ? JAM_PIECE_NAME[type as JamPieceType] : PIECE_NAME[type as PieceType]}</b>
              <p>{jam ? JAM_RULES[type as JamPieceType] : RULES[type as PieceType]}</p>
            </div>
            <span className="rules-when">{jam ? 'в пробке' : race ? RACE_WHEN[type] : WHEN[type as PieceType]}</span>
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
