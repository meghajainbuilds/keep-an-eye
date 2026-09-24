import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
// Inspect the exact committed or staged snapshot, not ignored local files.
const staged = process.argv.includes('--staged');
const git = args => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 20_000_000 });
const paths = (staged ? git(['ls-files', '-z']) : git(['ls-tree','-r','--name-only','-z','HEAD'])).split('\0').filter(Boolean);
const patterns = existsSync('.privacy-patterns') ? readFileSync('.privacy-patterns','utf8').split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!x.startsWith('#')) : [];
let failures = 0;
for(const path of paths) {
  if (/(^|\/)(?:data|outputs|work|screenshots|node_modules)\/|(^|\/)\.env(?!\.example$)|\.(?:sqlite(?:-[\w]+)?|db|pem|key|log|jpg|jpeg|png)$/i.test(path) || path === '.privacy-patterns') {
    console.error('Disallowed private/generated file:', path); failures++; continue;
  }
  const content = git(['show', staged ? ':' + path : 'HEAD:' + path]);
  if (patterns.some(p=>content.toLowerCase().includes(p.toLowerCase()))) { console.error('Private identifier in:',path); failures++; }
}
if (!staged) {
  for(const row of git(['log','--format=%ae%n%ce']).trim().split('\n')) {
    if (!/@users\.noreply\.github\.com$/.test(row)) { console.error('Commit history contains a non-private author email.'); failures++;break; }
  }
}
if(failures)process.exit(1);
console.log('Privacy snapshot check passed. Review the diff for shopping data before publishing.');
