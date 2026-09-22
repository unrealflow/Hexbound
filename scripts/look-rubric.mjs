/** look-rubric — append one rubric record per attacked axis (look-workflow §5.2)
 *  to docs/design/look-scores.md. Exit 1 on regression (any non-attacked axis
 *  dropping >= 1) so CI-style callers can fail the round.
 *  Usage:
 *    node scripts/look-rubric.mjs --shot 01 --axis composition \
 *      --before 0 --after 2 --evidence _look-p1-mode9.png \
 *      --others '{"调色":1,"光影":1,"水":2,"林":2,"河":0}' --others-before '{"调色":1,...}'
 */
import { appendFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'docs', 'design', 'look-scores.md');
const argv = process.argv;
const argOf = (n, d) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : d);

const shot = argOf('--shot', '01');
const axis = argOf('--axis', 'composition');
const before = Number(argOf('--before', '0'));
const after = Number(argOf('--after', '0'));
const evidence = argOf('--evidence', '');
const others = JSON.parse(argOf('--others', '{}'));
const othersBefore = JSON.parse(argOf('--others-before', '{}'));

const regressedAxes = Object.keys(others).filter((k) => k in othersBefore && othersBefore[k] - others[k] >= 1);
const record = {
  shot,
  axis,
  score_before: before,
  score_after: after,
  regressed: regressedAxes.length > 0 || after < before,
  evidence,
  others,
  ts: new Date().toISOString(),
};
if (!existsSync(OUT)) {
  appendFileSync(OUT, '# Look rubric scores (look-workflow §5.2)\n\n```json\n');
}
appendFileSync(OUT, JSON.stringify(record) + '\n');
if (record.regressed) {
  console.error(`FAIL: regression on [${regressedAxes.join(', ')}] or attacked axis dropped`);
  process.exit(1);
}
console.log(`OK: ${shot}/${axis} ${before} -> ${after} recorded`);
