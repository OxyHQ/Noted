// Fetch and verify one of the app's speech models into a directory.
//
//   node desktop/sidecar/fetch-model.mjs <tiny|base|small> <directory>
//
// Prints the path of the verified file on its last line.
import { fetchModel, readModelRecord } from './models.mjs';

const [id, directory] = process.argv.slice(2);
if (!id || !directory) throw new Error('usage: fetch-model.mjs <tiny|base|small> <directory>');
console.log(await fetchModel(readModelRecord(id), directory));
