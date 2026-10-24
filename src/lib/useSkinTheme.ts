import { useEffect } from 'react';
import { skinAppVars, skinIsLight, skinVars, type ResolvedSkin } from '../engine';

/**
 * Тема поля красит весь интерфейс, а не только доску.
 *
 * Переменные уходят на `:root`, поэтому их видят меню, магазин, рекорды и
 * модалки: игрок выбрал тему один раз и ждёт, что приложение станет его цвета,
 * пока он в нём. Держать тему только на партии нельзя - меню у человека с
 * «Короной» оставалось бы чужим тёмным экраном, а это выглядит как недоделка.
 *
 * `color-scheme` ставим вслед за палитрой: на светлой теме системные поля,
 * колесо прокрутки и автозаполнение обязаны стать светлыми, иначе браузер
 * нарисует тёмный скроллбар поверх пергамента.
 */
export function useSkinTheme(skin: ResolvedSkin | null): void {
  useEffect(() => {
    const root = document.documentElement;
    // Без профиля (экран загрузки) держим заводскую палитру: переменные с неё
    // снимает cleanup предыдущего прогона.
    if (!skin) return;
    const vars = { ...skinVars(skin), ...skinAppVars(skin) };
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
    root.style.colorScheme = skinIsLight(skin) ? 'light' : 'dark';
    return () => {
      for (const name of Object.keys(vars)) root.style.removeProperty(name);
      root.style.removeProperty('color-scheme');
    };
  }, [skin]);
}
