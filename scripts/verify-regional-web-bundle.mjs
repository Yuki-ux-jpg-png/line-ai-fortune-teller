import {readdir,readFile} from 'node:fs/promises';
const shared=new URL('../tw/web-shared/',import.meta.url),canonical=new URL('../src/',import.meta.url);
const names=(await readdir(canonical)).filter(f=>/^web-.*\\.ts$/.test(f)).sort();
if(JSON.stringify((await readdir(shared)).sort())!==JSON.stringify(names))throw new Error('Regional bundle module list differs');
for(const file of names)if(!(await readFile(new URL(file,shared))).equals(await readFile(new URL(file,canonical))))throw new Error('Regional bundle differs: '+file);
console.log('Taiwan bundle matches canonical Web modules');
