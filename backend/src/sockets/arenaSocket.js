export const setupArenaSocket = (io) => {
  io.on('connection', (socket) => {
    socket.on('join_room', (matchId) => {
      socket.join(matchId);
    });

    socket.on('leave_room', (matchId) => {
      socket.leave(matchId);
    });
  });
};