// Build artifact generated from canonical src/web-*.ts; never maintain a second implementation.
import {readdir,readFile,writeFile} from 'node:fs/promises';
const source=new URL('../web-shared/',import.meta.url),target=new URL('../src/',import.meta.url);
for(const file of await readdir(source)) {
 if(!/^web-[a-z-]+\\.ts$/.test(file))throw new Error('Unexpected shared module');
 await writeFile(new URL(file,target),await readFile(new URL(file,source)));
}
