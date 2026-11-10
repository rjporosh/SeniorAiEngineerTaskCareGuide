import { runRepositoryContract } from '../../../testing/repository.contract.js';
import { createMongoRepositories } from './mongo.repositories.js';

const uri = process.env.TEST_MONGODB_URI;
if (!uri) throw new Error('TEST_MONGODB_URI is required for integration tests (see docs/programmers-guide/testing.md)');

runRepositoryContract('mongodb', () => createMongoRepositories(uri));
