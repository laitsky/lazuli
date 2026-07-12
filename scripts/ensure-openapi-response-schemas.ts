const path = new URL('../apps/api/src/api-spec.yaml', import.meta.url);
const source = await Bun.file(path).text();
const lines = source.split('\n');
let currentPath = '';

for (let index = 0; index < lines.length; index += 1) {
  const pathMatch = /^  (\/[^:]+):$/.exec(lines[index] ?? '');
  if (pathMatch?.[1]) currentPath = pathMatch[1];
  const status = /^        '(2\d\d)':$/.exec(lines[index] ?? '');
  if (!status) continue;
  let end = index + 1;
  while (end < lines.length) {
    const line = lines[end] ?? '';
    if (line.trim() && line.length - line.trimStart().length <= 8) break;
    end += 1;
  }
  const block = lines.slice(index, end).join('\n');
  if (block.includes('\n          content:') || block.includes('\n          $ref:')) continue;
  const mediaType = currentPath.endsWith('.svg') ? 'image/svg+xml' : 'application/json';
  const schema = currentPath.endsWith('.svg')
    ? ['              type: string', '              format: binary']
    : ["              $ref: '#/components/schemas/ApiSuccessResponse'"];
  lines.splice(
    end,
    0,
    '          content:',
    `            ${mediaType}:`,
    '              schema:',
    ...schema
  );
  index = end + schema.length + 2;
}

await Bun.write(path, `${lines.join('\n').replace(/\n+$/, '')}\n`);
