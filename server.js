const io = require('socket.io')(3000, {
    cors: { origin: "*" } // Разрешаем подключение с любых адресов
});

const rooms = {}; // Хранилище активных комнат

io.on('connection', (socket) => {
    console.log('Новое подключение:', socket.id);

    // Создание комнаты Игроком 1
    socket.on('createRoom', () => {
        const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
        rooms[roomCode] = { players: [socket.id] };
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
    });

    // Подключение Игрока 2 по коду
    socket.on('joinRoom', (code) => {
        const room = rooms[code];
        if (room && room.players.length === 1) {
            room.players.push(socket.id);
            socket.join(code);
            socket.emit('joinedRoom', code); // Игрок 2 успешно вошел
            socket.to(code).emit('gameStarted'); // Сигнал Игроку 1 начать игру
        } else {
            socket.emit('errorMsg', 'Комната не найдена или уже занята');
        }
    });

    // Пересылка хода противнику
    socket.on('move', (data) => {
        socket.to(data.room).emit('opponentMove', data);
    });

    // Пересылка превращения пешки
    socket.on('promote', (data) => {
        socket.to(data.room).emit('opponentPromote', data);
    });

    socket.on('disconnect', () => {
        console.log('Отключился:', socket.id);
    });
});

console.log('WebSocket сервер запущен на порту 3000');
