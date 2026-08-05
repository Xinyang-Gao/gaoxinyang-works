//  词条库
const WORD_PAIRS = [
    { civilian: '苹果', undercover: '梨子' },
    { civilian: '篮球', undercover: '排球' },
    { civilian: '猫', undercover: '狗' },
    { civilian: '咖啡', undercover: '奶茶' },
    { civilian: '西瓜', undercover: '哈密瓜' },
    { civilian: '钢笔', undercover: '铅笔' },
    { civilian: '飞机', undercover: '直升机' },
    { civilian: '火车', undercover: '高铁' },
    { civilian: '玫瑰', undercover: '月季' },
    { civilian: '面包', undercover: '蛋糕' },
    { civilian: '牛奶', undercover: '豆浆' },
    { civilian: '手机', undercover: '平板' },
    { civilian: '电视', undercover: '电脑' },
    { civilian: '沙发', undercover: '椅子' },
    { civilian: '冰箱', undercover: '冰柜' },
    { civilian: '雨伞', undercover: '雨衣' },
    { civilian: '眼镜', undercover: '墨镜' },
    { civilian: '手表', undercover: '手环' },
    { civilian: '书包', undercover: '背包' },
    { civilian: '火锅', undercover: '麻辣烫' },
    { civilian: '饺子', undercover: '馄饨' },
    { civilian: '面条', undercover: '米线' },
    { civilian: '包子', undercover: '馒头' },
    { civilian: '可乐', undercover: '雪碧' },
    { civilian: '薯条', undercover: '薯片' },
    { civilian: '篮球', undercover: '足球' },
    { civilian: '钢琴', undercover: '电子琴' },
    { civilian: '出租车', undercover: '网约车' },
    { civilian: '护照', undercover: '身份证' },
    { civilian: '项链', undercover: '手链' },
];

//  游戏状态
const state = {
    phase: 'select', // 'select' | 'view' | 'playing' | 'over'
    playerCount: 5,
    players: [], // { id, word, isUndercover, isLocked, isEliminated }
    undercoverIndex: -1,
    civilianWord: '',
    undercoverWord: '',
    rememberedCount: 0,
    message: '',
    gameOver: false,
};

//  DOM 引用
const $ = (id) => document.getElementById(id);
const phaseSelect = $('phaseSelect');
const phaseView = $('phaseView');
const phasePlaying = $('phasePlaying');
const modalOverlay = $('modalOverlay');

const playerCountDisplay = $('playerCountDisplay');
const decrementBtn = $('decrementBtn');
const incrementBtn = $('incrementBtn');
const startGameBtn = $('startGameBtn');

const viewCardGrid = $('viewCardGrid');
const rememberedCount = $('rememberedCount');
const totalPlayersView = $('totalPlayersView');

const playCardGrid = $('playCardGrid');
const remainingCount = $('remainingCount');
const messageBox = $('messageBox');

const statusText = $('statusText');
const statusDot = $('statusDot');

const resultIcon = $('resultIcon');
const resultTitle = $('resultTitle');
const resultSub = $('resultSub');
const revealCivilian = $('revealCivilian');
const revealUndercover = $('revealUndercover');
const restartBtn = $('restartBtn');

//  工具函数
function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

//  游戏逻辑
function initGame() {
    const n = state.playerCount;
    const pair = pickRandom(WORD_PAIRS);
    state.civilianWord = pair.civilian;
    state.undercoverWord = pair.undercover;

    state.undercoverIndex = Math.floor(Math.random() * n);

    state.players = [];
    for (let i = 0; i < n; i++) {
        const isUndercover = (i === state.undercoverIndex);
        state.players.push({
            id: i,
            word: isUndercover ? state.undercoverWord : state.civilianWord,
            isUndercover: isUndercover,
            isLocked: false,
            isEliminated: false,
        });
    }

    state.rememberedCount = 0;
    state.gameOver = false;
    state.message = '';
}

function startViewPhase() {
    state.phase = 'view';
    phaseSelect.style.display = 'none';
    phaseView.classList.add('active');
    phasePlaying.classList.remove('active');
    modalOverlay.classList.remove('active');

    totalPlayersView.textContent = state.playerCount;
    rememberedCount.textContent = '0';
    updateStatus('查看词条', true);

    renderViewCards();
}

function startPlayingPhase() {
    state.phase = 'playing';
    phaseView.classList.remove('active');
    phasePlaying.classList.add('active');
    updateStatus('游戏进行', true);
    updateMessage('💬 点击编号投票淘汰卧底');
    renderPlayCards();
}

function endGame(winner, reason) {
    state.phase = 'over';
    state.gameOver = true;
    phasePlaying.classList.remove('active');

    if (winner === 'civilian') {
        resultIcon.innerHTML = '<i class="fas fa-trophy"></i>';
        resultTitle.textContent = '平民胜利！';
        resultSub.textContent = reason || '卧底已被成功找出 🕵️';
    } else {
        resultIcon.innerHTML = '<i class="fas fa-mask"></i>';
        resultTitle.textContent = '卧底获胜！';
        resultSub.textContent = reason || '平民已全部被淘汰';
    }
    revealCivilian.textContent = state.civilianWord;
    revealUndercover.textContent = state.undercoverWord;

    modalOverlay.classList.add('active');
    updateStatus('游戏结束', false);
}

//  渲染：查看词条卡片
function renderViewCards() {
    viewCardGrid.innerHTML = '';
    const n = state.players.length;

    state.players.forEach((player, index) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'card-wrapper';
        wrapper.dataset.index = index;

        const container = document.createElement('div');
        container.className = 'card-container';

        const card = document.createElement('div');
        card.className = 'card';
        card.dataset.index = index;

        // 正面
        const front = document.createElement('div');
        front.className = 'card-face card-front';
        front.innerHTML = `
                        <div class="card-number">${index + 1}</div>
                        <div class="card-label"><i class="fas fa-user"></i> 玩家</div>
                        <div class="lock-badge"><i class="fas fa-check-circle"></i> 已记住</div>
                        <div class="eliminated-badge"><i class="fas fa-times-circle"></i> 已淘汰</div>
                    `;

        // 反面 - 只显示词条
        const back = document.createElement('div');
        back.className = 'card-face card-back';
        back.innerHTML = `
                        <div class="word-text">${player.word}</div>
                    `;

        card.appendChild(front);
        card.appendChild(back);
        container.appendChild(card);

        // 记住按钮
        const actions = document.createElement('div');
        actions.className = 'card-actions';
        const btn = document.createElement('button');
        btn.className = 'btn-remember';
        btn.innerHTML = '<i class="fas fa-thumbtack"></i> 已记住';
        btn.dataset.index = index;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleRemember(index);
        });

        actions.appendChild(btn);
        wrapper.appendChild(container);
        wrapper.appendChild(actions);
        viewCardGrid.appendChild(wrapper);

        // 点击卡片翻转
        card.addEventListener('click', () => {
            if (player.isLocked) return;
            if (card.classList.contains('flipped')) {
                // 已翻转则不做额外操作
            } else {
                card.classList.add('flipped');
                clearTimeout(card._flipTimer);
                card._flipTimer = setTimeout(() => {
                    card.classList.remove('flipped');
                }, 1200);
            }
        });

        if (player.isLocked) {
            card.classList.add('locked');
            btn.disabled = true;
            btn.classList.add('done');
            btn.innerHTML = '<i class="fas fa-check-circle"></i> 已记住';
        }
    });

    updateRememberedCount();
}

//  渲染：游戏阶段卡片
function renderPlayCards() {
    playCardGrid.innerHTML = '';
    const alive = state.players.filter(p => !p.isEliminated);
    const totalAlive = alive.length;
    remainingCount.textContent = totalAlive;

    state.players.forEach((player, index) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'card-wrapper';

        const container = document.createElement('div');
        container.className = 'card-container';

        const card = document.createElement('div');
        card.className = 'card';
        card.dataset.index = index;

        if (player.isEliminated) {
            card.classList.add('eliminated');
        } else {
            card.classList.add('clickable-vote');
        }

        const front = document.createElement('div');
        front.className = 'card-face card-front';
        let badgeHtml = '';
        if (player.isEliminated) {
            badgeHtml = `<div class="eliminated-badge"><i class="fas fa-times-circle"></i> 已淘汰</div>`;
        } else {
            badgeHtml = `<div class="card-label"><i class="fas fa-hand-pointer"></i> 点击投票</div>`;
        }
        front.innerHTML = `
                        <div class="card-number">${index + 1}</div>
                        ${badgeHtml}
                    `;

        card.appendChild(front);
        container.appendChild(card);
        wrapper.appendChild(container);
        playCardGrid.appendChild(wrapper);

        if (!player.isEliminated) {
            card.addEventListener('click', () => {
                handleVote(index);
            });
        }
    });
}

//  交互处理
function handleRemember(index) {
    const player = state.players[index];
    if (player.isLocked) return;

    const wrappers = viewCardGrid.querySelectorAll('.card-wrapper');
    const wrapper = wrappers[index];
    const card = wrapper.querySelector('.card');
    const btn = wrapper.querySelector('.btn-remember');

    if (card.classList.contains('flipped')) {
        clearTimeout(card._flipTimer);
        card.classList.remove('flipped');
    }

    player.isLocked = true;
    card.classList.add('locked');
    btn.disabled = true;
    btn.classList.add('done');
    btn.innerHTML = '<i class="fas fa-check-circle"></i> 已记住';

    state.rememberedCount++;
    updateRememberedCount();

    const allLocked = state.players.every(p => p.isLocked);
    if (allLocked) {
        setTimeout(() => {
            startPlayingPhase();
        }, 500);
    }
}

function handleVote(index) {
    if (state.gameOver) return;
    const player = state.players[index];
    if (player.isEliminated) return;

    if (!confirm(`确定要淘汰 ${index + 1} 号玩家吗？`)) {
        return;
    }

    player.isEliminated = true;
    const alive = state.players.filter(p => !p.isEliminated);
    const aliveCount = alive.length;

    if (player.isUndercover) {
        endGame('civilian', '卧底已被成功找出 🎯');
        return;
    } else {
        if (aliveCount < 3) {
            endGame('undercover', '平民已全部被淘汰');
            return;
        } else {
            updateMessage(`❌ ${index + 1} 号不是卧底，游戏继续`);
            renderPlayCards();
        }
    }
}

//  UI 更新
function updateRememberedCount() {
    rememberedCount.textContent = state.rememberedCount;
}

function updateMessage(msg) {
    state.message = msg;
    // 保留图标，替换文本
    const icon = messageBox.querySelector('i');
    if (icon) {
        messageBox.innerHTML = '';
        messageBox.appendChild(icon);
        const textNode = document.createTextNode(' ' + msg.replace(/[💬❌]/g, '').trim());
        messageBox.appendChild(textNode);
    } else {
        messageBox.innerHTML = msg;
    }
}

function updateStatus(text, active) {
    statusText.textContent = text;
    if (active) {
        statusDot.className = 'dot';
    } else {
        statusDot.className = 'dot inactive';
    }
}

//  人数选择
function updatePlayerCountDisplay() {
    playerCountDisplay.textContent = state.playerCount;
}

decrementBtn.addEventListener('click', () => {
    if (state.playerCount > 3) {
        state.playerCount--;
        updatePlayerCountDisplay();
    }
});

incrementBtn.addEventListener('click', () => {
    if (state.playerCount < 12) {
        state.playerCount++;
        updatePlayerCountDisplay();
    }
});

//  开始游戏
startGameBtn.addEventListener('click', () => {
    initGame();
    startViewPhase();
});

//  重新开始
restartBtn.addEventListener('click', () => {
    modalOverlay.classList.remove('active');
    state.phase = 'select';
    phaseSelect.style.display = 'flex';
    phaseView.classList.remove('active');
    phasePlaying.classList.remove('active');
    updateStatus('选择人数', false);
    state.playerCount = 5;
    updatePlayerCountDisplay();
    viewCardGrid.innerHTML = '';
    playCardGrid.innerHTML = '';
    messageBox.innerHTML = '<i class="fas fa-comment-dots"></i> 点击编号投票淘汰卧底';
});

//  初始状态
updatePlayerCountDisplay();
updateStatus('选择人数', false);

// 键盘快捷键
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        if (state.phase === 'select') {
            startGameBtn.click();
        } else if (state.phase === 'over') {
            restartBtn.click();
        }
    }
    if (e.key === 'Escape' && state.phase === 'over') {
        restartBtn.click();
    }
});

console.log('谁是卧底游戏已加载！');
console.log(`词条库共 ${WORD_PAIRS.length} 组`);