# Переводит .bat в кодировку 866 (родная для консоли русской Windows) и убирает «chcp 65001».
# Зачем: в UTF-8 после chcp 65001 cmd читает файл со сдвигом и выполняет обрывки строк — так могли «развалиться»
# даже проверки «Напиши ДА» в ВЫЛОЖИТЬ-MAINNET.bat. В 866 каждый символ — один байт, и сдвига нет.
# Запуск: py -I fix-bat.py  (повторно запускать безопасно: уже переведённые файлы пропускаются)
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
NOTE = 'rem Файл в кодировке 866 (DOS, русская) - редактировать в ней, иначе русский текст сломается.'
SWAP = {'«': '"', '»': '"', '—': '-', '–': '-', '…': '...'}

for f in sorted(ROOT.glob('*.bat')):
    raw = f.read_bytes()
    try:
        text = raw.decode('utf-8')
    except UnicodeDecodeError:
        print('уже в 866:', f.name)
        continue
    lines = [l for l in text.replace('\r\n', '\n').split('\n') if l.strip().lower() != 'chcp 65001 >nul']
    if lines and lines[-1] == '':
        lines.pop()
    if NOTE not in lines:
        lines.insert(1, NOTE)
    out = '\r\n'.join(lines) + '\r\n'
    for a, b in SWAP.items():
        out = out.replace(a, b)
    f.write_bytes(out.encode('cp866'))  # strict: если символа нет в 866 — ошибка, а не тихая порча
    print('переведён в 866:', f.name)
