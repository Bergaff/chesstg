import type { ReactNode } from 'react';
import { PIECE_GLYPH, PIECE_NAME, type PieceType } from '../engine';
import { Icon } from './Icon';
import { Modal } from './Modal';

const ENEMIES: PieceType[] = ['pawn', 'rook', 'bishop', 'knight', 'queen'];

const RULES: Record<PieceType, string> = {
  pawn: 'Один шаг вниз. Бьёт по диагонали. Вперёд на тебя не нападает.',
  rook: 'По горизонтали и вертикали на любое расстояние.',
  bishop: 'По диагонали на любое расстояние.',
  knight: 'Буквой Г: две клетки в одну сторону и одна в другую.',
  queen: 'Как ладья и слон вместе. Появляется с 15 уровня.',
};

export function RulesModal({ onClose }: { onClose: () => void }): ReactNode {
  return (
    <Modal onClose={onClose} showClose className="rules-modal">
      <span className="eyebrow">Памятка</span>
      <h2 className="modal-title" id="rules-title">Как играть</h2>
      <p className="modal-text">
        Ты — пешка. Фигуры охотятся по классическим шахматным правилам, но бьют только тебя.
        Дойди до верхнего ряда и не дай себя поймать.
      </p>

      <ol className="rules-steps">
        <li>
          <span>1</span>
          <div>
            <b>Ходи только вперёд</b>
            <p>Прямо, влево-вперёд или вправо-вперёд. Назад и вбок нельзя.</p>
          </div>
        </li>
        <li>
          <span>2</span>
          <div>
            <b>Обходи фигуры</b>
            <p>Пешка не бьёт. Если все три клетки впереди закрыты — придётся пропустить ход.</p>
          </div>
        </li>
        <li>
          <span>3</span>
          <div>
            <b>Дойди до края</b>
            <p>Верхний ряд — победа. В бесконечном режиме забирайся как можно выше.</p>
          </div>
        </li>
      </ol>

      <div className="rules-pieces">
        <div className="rules-pieces-head">
          <span>Фигуры</span>
          <span>Когда</span>
        </div>
        {ENEMIES.map((type, index) => (
          <div className="rules-piece" key={type}>
            <span className={`rules-glyph rules-${type}`}>{PIECE_GLYPH[type]}</span>
            <div>
              <b>{PIECE_NAME[type]}</b>
              <p>{RULES[type]}</p>
            </div>
            <span className="rules-when">{type === 'pawn' ? 'с 1' : type === 'rook' ? 'с 3' : type === 'bishop' ? 'с 5' : type === 'knight' ? 'с 8' : 'с 15'}</span>
          </div>
        ))}
      </div>

      <div className="rules-meta">
        <div><Icon name="heart" size={16} /> 5 жизней, +1 каждые 30 минут</div>
        <div><Icon name="coin" size={16} /> монеты за уровни — на бонусы</div>
        <div><Icon name="shield" size={16} /> щит защищает от фигур три хода</div>
      </div>

      <button type="button" className="btn btn-gold" onClick={onClose}>
        Понятно
      </button>
    </Modal>
  );
}
