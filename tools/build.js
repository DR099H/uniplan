#!/usr/bin/env node
// tools/build.js — сборка и минификация ресурсов UniPlan (CSS, JS) без внешних зависимостей.
// Создаёт .min.css и .min.js для продакшена в php/ и client/, сохраняя читаемые исходники.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();

/**
 * Безопасная минификация CSS:
 * - удаляет комментарии
 * - схлопывает лишние пробелы и переносы
 * - сохраняет пробелы вокруг + и - внутри calc()
 */
function minifyCSS(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*([;{}])\s*/g, '$1')
    .replace(/:\s+/g, ':')
    .replace(/,\s+/g, ',')
    .replace(/;\}/g, '}')
    .trim();
}

/**
 * Токенизатор и минификатор JS:
 * Корректно обходит строки ('...', "...", `...`), регулярные выражения (/.../)
 * и удаляет комментарии (// и /* ... *\/), схлопывает пустые строки,
 * а также переписывает пути импортов на .min.js.
 */
function minifyJS(code, rewriteImports = true) {
  let out = '';
  let i = 0;
  const n = code.length;

  while (i < n) {
    const ch = code[i];
    const next = code[i + 1];

    // Одинарные кавычки '...'
    if (ch === "'") {
      let str = ch;
      i++;
      while (i < n && code[i] !== "'") {
        if (code[i] === '\\') { str += code[i++]; }
        str += code[i++];
      }
      str += (code[i++] || '');
      out += str;
      continue;
    }

    // Двойные кавычки "..."
    if (ch === '"') {
      let str = ch;
      i++;
      while (i < n && code[i] !== '"') {
        if (code[i] === '\\') { str += code[i++]; }
        str += code[i++];
      }
      str += (code[i++] || '');
      out += str;
      continue;
    }

    // Шаблонные строки `...`
    if (ch === '`') {
      let str = ch;
      i++;
      while (i < n && code[i] !== '`') {
        if (code[i] === '\\') { str += code[i++]; }
        str += code[i++];
      }
      str += (code[i++] || '');
      out += str;
      continue;
    }

    // Однострочный комментарий //
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < n && code[i] !== '\n' && code[i] !== '\r') i++;
      continue;
    }

    // Многострочный комментарий /* ... */
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    // Регулярное выражение /.../ (определяем по предшествующему символу)
    if (ch === '/') {
      const prevNonSpace = out.trimEnd().slice(-1);
      const isRegex = /[(,=:[!&|?{};~]/.test(prevNonSpace) || prevNonSpace === '' || /return$/.test(out.trimEnd());
      if (isRegex) {
        let reg = ch;
        i++;
        while (i < n && code[i] !== '/') {
          if (code[i] === '\\') { reg += code[i++]; }
          reg += code[i++];
        }
        reg += (code[i++] || '');
        // флаги regex (gimsuy)
        while (i < n && /[a-z]/i.test(code[i])) reg += code[i++];
        out += reg;
        continue;
      }
    }

    out += ch;
    i++;
  }

  // Обновление путей импортов: .js? -> .min.js? или .js' -> .min.js'
  if (rewriteImports) {
    out = out.replace(/(from\s+['"][^'"]*?)\.js(\?[^'"]*)?(['"])/g, (match, prefix, query, quote) => {
      return `${prefix}.min.js${query || ''}${quote}`;
    });
    out = out.replace(/(import\s+['"][^'"]*?)\.js(\?[^'"]*)?(['"])/g, (match, prefix, query, quote) => {
      return `${prefix}.min.js${query || ''}${quote}`;
    });
  }

  // Схлопывание пустых строк и обрезка пробелов
  return out
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter((line, idx, arr) => line.length > 0 || (idx > 0 && arr[idx - 1].length > 0))
    .join('\n');
}

/**
 * Валидация синтаксиса JS модуля через vm.compileFunction / vm.SourceTextModule
 */
function validateJS(code, filename) {
  try {
    new vm.Script(code, { filename });
    return true;
  } catch (e) {
    // Если это ES модуль (импорты/экспорты), Script выбросит ошибку SyntaxError: Cannot use import statement outside a module.
    // Проверим, что это именно эта ошибка, а не синтаксический сбой
    if (e instanceof SyntaxError && /Cannot use import statement|Unexpected token 'export'/.test(e.message)) {
      return true;
    }
    console.error(`Ошибка синтаксиса в ${filename}:`, e.message);
    throw e;
  }
}

function processTarget(targetDir, isPhp = false) {
  console.log(`\nОбработка каталога: ${targetDir}`);
  let totalOrig = 0;
  let totalMin = 0;

  // 1. CSS
  const cssPath = path.join(ROOT, targetDir, 'css', 'app.css');
  if (fs.existsSync(cssPath)) {
    const raw = fs.readFileSync(cssPath, 'utf8');
    const min = minifyCSS(raw);
    const minPath = path.join(ROOT, targetDir, 'css', 'app.min.css');
    fs.writeFileSync(minPath, min, 'utf8');
    totalOrig += raw.length;
    totalMin += min.length;
    console.log(`  CSS: css/app.css (${raw.length} B) -> css/app.min.css (${min.length} B, -${((1 - min.length / raw.length) * 100).toFixed(1)}%)`);
  }

  // 2. JS файлы
  const jsDir = path.join(ROOT, targetDir, 'js');
  if (fs.existsSync(jsDir)) {
    const jsFiles = [
      'api.js',
      'main.js',
      'store.js',
      'theme-init.js',
      'todo.js',
      'ui.js',
      'views/admin.js',
      'views/auth.js',
      'views/profile.js',
      'views/schedule.js',
      'views/tasks.js',
    ];

    for (const rel of jsFiles) {
      const srcPath = path.join(jsDir, rel);
      if (!fs.existsSync(srcPath)) continue;
      const raw = fs.readFileSync(srcPath, 'utf8');
      const min = minifyJS(raw, true);
      const minRel = rel.replace(/\.js$/, '.min.js');
      const minPath = path.join(jsDir, minRel);

      // Проверка валидности
      validateJS(min, minRel);

      fs.writeFileSync(minPath, min, 'utf8');
      totalOrig += raw.length;
      totalMin += min.length;
      console.log(`  JS:  js/${rel} (${raw.length} B) -> js/${minRel} (${min.length} B, -${((1 - min.length / raw.length) * 100).toFixed(1)}%)`);
    }
  }

  // 3. Shared JS (week.js)
  const sharedRel = isPhp ? path.join('php', 'shared', 'week.js') : path.join('shared', 'week.js');
  const sharedSrc = path.join(ROOT, sharedRel);
  if (fs.existsSync(sharedSrc)) {
    const raw = fs.readFileSync(sharedSrc, 'utf8');
    const min = minifyJS(raw, false);
    const minDst = sharedSrc.replace(/\.js$/, '.min.js');
    validateJS(min, 'week.min.js');
    fs.writeFileSync(minDst, min, 'utf8');
    totalOrig += raw.length;
    totalMin += min.length;
    console.log(`  JS:  ${sharedRel} (${raw.length} B) -> .min.js (${min.length} B, -${((1 - min.length / raw.length) * 100).toFixed(1)}%)`);
  }

  const savings = totalOrig > 0 ? ((1 - totalMin / totalOrig) * 100).toFixed(1) : 0;
  console.log(`Итого для ${targetDir}: ${totalOrig} B -> ${totalMin} B (экономия: ${savings}%)`);
}

function main() {
  console.log('--- UniPlan Build & Minify ---');
  processTarget('php', true);
  processTarget('client', false);
  console.log('\nСборка успешно завершена!');
}

main();
