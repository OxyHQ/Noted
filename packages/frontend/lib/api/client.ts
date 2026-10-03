import { oxyServices } from '../oxy';
import config from '../config';
import { createNotedClient } from './noted-client';

// The same SDK instance is mounted by OxyProvider. The SDK owns authentication.
export default createNotedClient(oxyServices, config.apiUrl);
