import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cookieParser from 'cookie-parser'
import { setupArenaSocket } from './sockets/arenaSocket.js';

import authRoutes from './routes/auth.js';
import quizRoutes from './routes/quizzes.js';
import arenaRoutes from './routes/arena.js';
import profileRoutes from './routes/profiles.js';
import playRoutes from './routes/play.js';

dotenv.config();

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(express.json());
app.use(cookieParser())

app.use('/api/auth', authRoutes);
app.use('/api/quizzes', quizRoutes);
app.use('/api/arena', arenaRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/play', playRoutes);

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: process.env.FRONTEND_URL, credentials: true },
});

setupArenaSocket(io);

app.set('io', io); // access io inside routes via req.app.get('io')

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));