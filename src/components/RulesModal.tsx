import type { ReactNode } from 'react';
import { PIECE_GLYPH, PIECE_NAME, type PieceType } from '../engine';
import { Modal } from './Modal';

const ENEMIES: PieceType[] = ['pawn', 'rook', 'bishop', 'knight', 'queen'];

const RULES: Record<PieceType, string> = {
  pawn: 'Шагает на одну клетку вниз и бьёт по диагонали вниз.',
  rook: 'Ходит по горизонтали и вертикали на любое расстояние.',
  bishop: 'Ходит по диагонали на любое расстояние.',
  knight: 'Прыгает буквой Г: две клетки в одну сторону и одна в другую.',
  queen: 'Сочетает ладью и слона. Появляется на пятнадцатом уровне.',
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
}: {
  onClose: () => void;
  onTerms: () => void;
  onPrivacy: () => void;
}): ReactNode {
  return (
    <Modal onClose={onClose} showClose className="" labelledBy="rules-title">
      <span className="label">Памятка</span>
      <h2 className="modal-title" id="rules-title">
        Как играть
      </h2>
      <p className="modal-text">
        Пешка идёт через доску снизу вверх. Фигуры ходят по шахматным правилам и стараются её поймать.
        Задача простая: довести пешку до верхнего ряда.
      </p>

      <ol className="rules-steps">
        <li>
          <span>1</span>
          <div>
            <b>Только вперёд</b>
            <p>Прямо, влево-вперёд или вправо-вперёд. Назад и вбок нельзя.</p>
          </div>
        </li>
        <li>
          <span>2</span>
          <div>
            <b>Обход фигур</b>
            <p>Пешка не бьёт. Если все три клетки впереди закрыты, ход пропускается, но фигуры всё равно двигаются.</p>
          </div>
        </li>
        <li>
          <span>3</span>
          <div>
            <b>Верхний ряд</b>
            <p>Любая клетка верхнего ряда приносит победу. В бесконечном режиме нужно подняться как можно выше.</p>
          </div>
        </li>
      </ol>

      <div className="rules-pieces">
        <div className="rules-pieces-head">
          <span>Фигуры</span>
          <span>Появляется</span>
        </div>
        {ENEMIES.map((type) => (
          <div className="rules-piece" key={type}>
            <span className={`rules-glyph rules-${type}`}>{PIECE_GLYPH[type]}</span>
            <div>
              <b>{PIECE_NAME[type]}</b>
              <p>{RULES[type]}</p>
            </div>
            <span className="rules-when">{WHEN[type]}</span>
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
