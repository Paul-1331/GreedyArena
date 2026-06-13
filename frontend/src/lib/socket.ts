import { io, Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export const socket: Socket = io(SOCKET_URL, {
  withCredentials: true,
  autoConnect: true,
});