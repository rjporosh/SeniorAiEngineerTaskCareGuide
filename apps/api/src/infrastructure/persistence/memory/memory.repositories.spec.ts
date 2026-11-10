import { runRepositoryContract } from '../../../testing/repository.contract.js';
import { createMemoryRepositories } from './memory.repositories.js';

runRepositoryContract('memory', async () => createMemoryRepositories());
