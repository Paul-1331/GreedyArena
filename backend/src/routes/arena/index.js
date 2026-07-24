/**
 * Arena router — mounts lobby, official, and results sub-routers.
 * All gameplay (submit_answer, next_question) is handled by Socket.IO in arenaSocket.js.
 */
import { Router } from 'express';
import lobbyRouter from './lobby.js';
import officialRouter from './official.js';
import resultsRouter from './results.js';

const router = Router();

router.use('/', lobbyRouter);
router.use('/', officialRouter);
router.use('/', resultsRouter);

export default router;
