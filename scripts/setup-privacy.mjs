import { execFileSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
for(const hook of ['pre-commit','pre-push'])chmodSync('.githooks/'+hook,0o755);
for(const args of [['core.hooksPath','.githooks'],['user.name','Keep an Eye contributors'],['user.email','contributors@users.noreply.github.com']])execFileSync('git',['config','--local',...args]);
console.log('Local privacy hooks and neutral commit identity configured. Install Gitleaks before committing.');
