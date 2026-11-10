import { runRepositoryContract } from '../../../testing/repository.contract.js';
import { createPostgresRepositories } from './postgres.repositories.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL is required for integration tests (see docs/programmers-guide/testing.md)');

runRepositoryContract('postgres', async () => createPostgresRepositories(url));
