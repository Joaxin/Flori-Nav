/* 桌宠(小鲸鱼)——从 nav_sites.html 拆出的第一刀(2026-10-25,渐进拆分)。
   范围:动画池/互动/右键菜单/设置弹窗/签到养成/天气/节日/AI 聊天碎碎念余额(移植 dsh-pet)。
   与主脚本(nav_sites.html 内联)的边界约定:
   - 宿主共享工具由主脚本挂到 window(navToast/navCsrf/navLsGet/navLsSet/navCardInfo/
     navTouchRecent/renderNavStars/petNotify),本文件在 jQuery ready 里取用——
     ready 注册顺序:主脚本在前、本文件在后,执行时 window 上已有这些工具;
   - AI 相关 URL 走模板渲染的 JSON 配置岛 #navPetAiUrls(静态文件里禁模板标签);
   - 对外暴露 window.navPetState/navPetWork/navPetSay/petAiOpen/petAiChatOpen/
     petAiChatClose/petAiBalance,主脚本与第二脚本只经 window 调用。
   本文件随导航页加载,不依赖 searchapp/content_engine(模块移植规则)。*/
jQuery(function ($) {
    'use strict';
    // 宿主共享工具(见文件头边界约定);navTouchRecent/renderNavStars 保留 undefined 可能,typeof 守卫照常生效
    const csrf = window.navCsrf, showToast = window.navToast;
    const navLsGet = window.navLsGet, navLsSet = window.navLsSet;
    const navCardInfo = window.navCardInfo, navTouchRecent = window.navTouchRecent;
    const renderNavStars = window.renderNavStars, petNotify = window.petNotify;
    const PET_AI_URLS = JSON.parse(document.getElementById('navPetAiUrls').textContent);
    // ===== 实验功能:桌宠物(小鲸鱼)——全部代码仅在 nav 模块内,只随导航页加载 =====
    // 台词只聊导航功能本身(不碰具体业务内容)
    const PET_QUOTES = ['找不到网站?上面大框直接搜', 'Ctrl+K 一秒聚焦搜索框',
        '点卡片角上的 ☆ 就能星标', '双击我看看家底', '拖我挪窝,甩一下也行',
        '🎨 菜单里能换 10 套主题', '链接测活帮你扫死链', '搜索引擎随时可以换',
        '今天收藏新网站了吗?', '设置里能换必应今日壁纸'];
    // ===== 形态进化(2026-10-25 brainstorm 落地):Lv 越高形态越高,体型默认值/说话风格/闲置动作池跟着变 =====
    // 说话台词分档:幼鲸软萌 → 少年鲸精神 → 壮年鲸老练 → 传奇鲸淡定沧桑
    const PET_QUOTES_TEEN = ['这导航被我整理得明明白白', '新的死链?交给我', '分类又变好看了呢', '测活这种小事包在我身上', '今天也一路成长中', '有话快说,我忙着变强'];
    const PET_QUOTES_MATURE = ['导航如水,收放自如', '死链清完,神清气爽', '整理收藏,即是整理心情', '别急,一个一个来', '稳住,我们能赢', '这批站质量不错'];
    const PET_QUOTES_LEGEND = ['海阔凭鲸跃', '万站过尽,云淡风轻', '你只管收藏,烂链有我', '稳了', '百年导航,此刻最静', '传奇也要偶尔摸鱼'];
    const PET_TIERS = [
        {minLv: 1,  name: '幼鲸',   size: 128, pools: ['idle', 'play'],
         quotes: null},   // null = 沿用 PET_QUOTES(软萌原版)
        {minLv: 3,  name: '少年鲸', size: 148, pools: ['idle', 'play', 'eat'],      quotes: PET_QUOTES_TEEN},
        {minLv: 5,  name: '壮年鲸', size: 168, pools: ['idle', 'play', 'eat', 'show'], quotes: PET_QUOTES_MATURE},
        {minLv: 10, name: '传奇鲸', size: 188, pools: ['idle', 'play', 'eat', 'show', 'festival'], quotes: PET_QUOTES_LEGEND}
    ];
    function petTierIdx() {
        const lv = petLevelOf(petSignData().score);
        let idx = 0;
        PET_TIERS.forEach(function(t, i) { if (lv >= t.minLv) idx = i; });
        return idx;
    }
    function petTier() { return PET_TIERS[petTierIdx()]; }
    // ===== 高分辨率/宽屏自适应(2026-11-18 用户:「字很小看不见」) =====
    // 12px 在 1080p 正好,在 4K@200% 或 1440p@125% 就偏小;按屏幕物理像素宽度开根号缩放,
    // 1080p→100%、1440p→115%、4K→141%,并允许设置里手动覆盖。
    function petAutoUiScale() {
        const cssW = window.innerWidth || 1920;
        const w = (((window.screen && screen.width) || cssW)
            * (window.devicePixelRatio || 1));
        const byScreen = Math.sqrt(w / 1920);
        // 宽屏逻辑宽度也参与：1800px 约 1.13，2560px 约 1.37；避免只看物理像素时
        // 2K/4K 缩放比例不高导致桌宠、聊天窗和设置弹窗仍然偏小。
        const byWidth = 1 + Math.max(0, cssW - 1400) / 1400 * 0.45;
        return Math.max(1, Math.min(1.6, Math.max(byScreen, byWidth)));
    }
    function petUiScale() {
        const raw = localStorage.getItem('navPetUiScale') || 'auto';
        if (raw === 'auto') return petAutoUiScale();
        const n = parseFloat(raw);
        return isFinite(n) ? Math.max(0.8, Math.min(2, n)) : 1;
    }
    function petApplyUiScale() {
        const s = petUiScale();
        document.documentElement.style.setProperty('--pet-ui-scale', s.toFixed(3));
        return s;
    }
    function petIdleUnlocked() {   // 当前形态解锁的闲置池(用户勾选会先按解锁过滤)
        return PET_TIERS.slice(0, petTierIdx() + 1).reduce(function(acc, t) { return acc.concat(t.pools); }, []);
    }

    // 动画池(素材来自 dsh-pet,MIT,素材禁商用;全量 106 个 webm 已搬入 nav/static/pet/)
    // 拖拽/走路/失败是功能池(由交互自动触发),其余池在动作点播弹窗与"随机来一个"里轮换
    const PET_POOL = {
        idle: ['待机呼吸休闲', '碎碎念-发呆碎碎念', '碎碎念-对屏碎碎念', '碎碎念-擦桌碎碎念', '深度思考碎碎念', '东张西望', '哈欠连天', '超大伸懒腰', '原地敲击桌面互动', '用鲸鱼尾巴拍打地面', '摇扇纳凉', '晨间刷牙', '照镜子'],
        click: ['被吓一跳', '点击回应-傲娇生气', '点击回应-开心跃动', '点击回应-害羞惊讶', '点击回应-元气挥手', '点击回应-挠痒咯咯笑', '打瞌睡被惊醒'],
        work: ['工作状态-思考冒泡', '工作状态-忙碌点按', '工作状态-清点归档', '工作状态-原地踱步张望', '工作状态-垂头叹气冒汗', '写代码', '轻快记录'],
        happy: ['工作状态-雀跃庆祝'],
        eat: ['涮火锅', '吃Token', '吃冰淇淋融化', '吃午餐', '吃大闸蟹', '吃年糕', '吃早餐', '吃晚餐', '吃汤圆', '吃白饭', '吃粽子', '吃糖葫芦', '吃腊八粥', '吃西瓜', '吃重阳糕', '吃长寿面', '吃青团', '吃饺子', '大口吃零食', '偷吃零食被抓住', '是啊，吃什么'],
        play: ['三球抛接', '下五子棋', '原地专心玩魔方', '原地跳跃抓碎头顶物品', '原地蹲下玩玩具汽车', '原地重力下蹲压缩', '变鸽子', '堆雪人', '扑克魔术', '抽陀螺', '拆礼物', '撸猫', '放风筝', '玩水枪', '玩游戏气急败坏', '荡秋千', '骑木马', '踢毽子'],
        festival: ['中秋赏月吃月饼', '写福字', '插茱萸赏菊', '收红包', '放孔明灯', '放河灯', '放烟花', '穿针乞巧', '舞狮头', '装点圣诞树', '讨糖南瓜灯'],
        show: ['优雅女仆舞', '凭空生花', '动物环绕', '可爱宅舞', '吹气球', '吹笛子', '女仆屈膝礼仪', '小幅度原地360度旋转展示', '小提琴演奏', '悠闲哼歌', '整体换装试色', '轻快摇摆舞', '萌化小幽灵', '蓝鲸现世', '蝴蝶蜜蜂环绕头顶开花', '被落叶淹没', '鲸鱼吐泡泡特效'],
        walk: ['原地左转奔跑', '原地漂浮踏步', '螃蟹走路'],
        sleep: ['原地小憩沉眠'],
        drag: ['被鼠标拖拽悬空反馈'],
        balance: ['余额-分文不剩', '余额-数金皱眉', '余额-袋空如洗', '余额-金袋叮当', '余额-钱袋如常', '余额-钱袋满溢']
    };
    // 睡觉三段(dsh-pet 0.4.7 的睡觉套:睡下 → 循环 → 起来),首尾帧互相对齐,只能按顺序接力播
    const PET_SLEEP = { start: '睡觉-开始', loop: '睡觉-循环', end: '睡觉-起来' };
    // 吃白饭玩法五段(顺序即契约,第 5 段是吃饭,前 4 段是跑过来/期待)
    const PET_BAIFAN = ['开心小跑', '侧身急躁跑', '期待开饭', '吃饭·碗饭', '吃饭团'];
    let petSeq = null;   // 顺序播放队列(吃白饭等多段演出)
    // 表情包(dsh-pet assets/memes,27 张 PNG 已搬入 nav/static/pet/memes/)
    const PET_MEMES = ['Ciallo', 'token给妈妈保管', '假如给我三天多模态', '先养着吧', '厉害了我的鲸', '压力一只大肥鱼', '可爱', '吃白饭的大肥鱼', '吃饱饱摸肚子', '哦鲸鲸', '哪来的电脑病毒', '大师这个区是什么意思', '大烧货', '大的药来了', '大的要来啦', '完蛋了把黄油删了', '就一碗', '就骚了怎么滴吧', '我不更新你们用什么', '死掉了', '深度睡眠', '电死你', '要不直接骂他', '誓死践行开源精神', '除了调情没啥用', '鱼片有资源吗', '黎曼猜想没证明喵'];
    // 动作点播弹窗的分组展示顺序(工作池合并雀跃庆祝;拖拽并入走路行)
    const PET_GROUPS = [
        ['待机', PET_POOL.idle], ['回应', PET_POOL.click],
        ['工作', PET_POOL.work.concat(PET_POOL.happy)],
        ['吃饭', PET_POOL.eat], ['玩耍', PET_POOL.play],
        ['节日', PET_POOL.festival], ['表演', PET_POOL.show],
        ['睡觉', PET_POOL.sleep], ['走路 / 拖拽', PET_POOL.walk.concat(PET_POOL.drag)],
        ['余额', PET_POOL.balance]
    ];
    // 稀有动作组(积分商店购买后出现在点播弹窗;不进随机池)
    const PET_RARE = ['蓝鲸现世', '凭空生花', '扑克魔术', '鲸鱼吐泡泡特效'];
    // "随机来一个"的抽样范围(排除拖拽/走路等功能池)
    const PET_FUN = PET_POOL.idle.concat(PET_POOL.click, PET_POOL.work, PET_POOL.happy,
        PET_POOL.eat, PET_POOL.play, PET_POOL.festival, PET_POOL.show, PET_POOL.sleep);
    // document 级拖拽监听:重挂/卸载时移除旧的一对,否则开关一次积一对(泄漏)
    let petDocMove = null, petDocUp = null;

    // ===== 气泡优先级槽(蒸馏 dsh-pet bubble-slots)=====
    // 碎碎念 1 / 余额 2 / 工作 3 / 待办 4:高优先级气泡在有效期内不被低优先级顶掉。
    const PET_BUBBLE_PRIO = { whisper: 1, balance: 2, work: 3, todo: 4 };
    let petBubblePrio = 0, petBubbleUntil = 0;

    // ===== 加权随机动画链(蒸馏 dsh-pet next-animation)=====
    // 不连着播同一条;最近播过的按远近降权,避免「连着三次伸懒腰」。
    const petAnimHistory = [];
    function petPickAnim(pool) {
        if (!pool || !pool.length) return null;
        if (pool.length === 1) return pool[0];
        const last = petAnimHistory[petAnimHistory.length - 1];
        const recent = petAnimHistory.slice(-3);
        const candidates = pool.filter(function(n) { return n !== last; });
        const list = candidates.length ? candidates : pool.slice();
        const weights = list.map(function(n) {
            const idx = recent.lastIndexOf(n);
            if (idx < 0) return 1;
            return idx === recent.length - 1 ? 0.15 : 0.45;   // 越近权重越低
        });
        let total = 0;
        weights.forEach(function(w) { total += w; });
        let r = Math.random() * total, pick = list[list.length - 1];
        for (let i = 0; i < list.length; i++) { r -= weights[i]; if (r <= 0) { pick = list[i]; break; } }
        petAnimHistory.push(pick);
        if (petAnimHistory.length > 8) petAnimHistory.shift();
        return pick;
    }
    // 播完接 cue(上游 cues.ts 的最小可用版):这几条收尾动作接一个指定的后续动作
    const PET_CUES = {
        '哈欠连天': '待机呼吸休闲',
        '超大伸懒腰': '待机呼吸休闲',
        '晨间刷牙': '照镜子',
        '原地敲击桌面互动': '东张西望',
        '吃白饭': '用鲸鱼尾巴拍打地面',
        '深度思考碎碎念': '照镜子'
    };

    /* 开关必须和真实状态对齐(2026-11-14)。
       之前设置面板里的复选框从来没被初始化过:桌宠默认是开的(<缺省即 on>),
       但那个框一直显示未勾选 —— 用户看到"关着却还在",以为开关坏了。 */
    function navPetSyncToggle() {
        const cb = document.getElementById('setPetOn');
        if (cb) cb.checked = localStorage.getItem('navPetOn') !== '0';
    }

    function navPetMount() {
        const on = localStorage.getItem('navPetOn') !== '0';
        const old = document.getElementById('navPet');
        if (!on) {
            if (petDocMove) { document.removeEventListener('mousemove', petDocMove); petDocMove = null; }
            if (petDocUp) { document.removeEventListener('mouseup', petDocUp); petDocUp = null; }
            if (old) old.remove();
            return;
        }
        if (old) return;
        const pet = document.createElement('div');
        pet.id = 'navPet';
        const bubble = document.createElement('div');
        bubble.className = 'nav-pet-bubble d-none';
        const body = document.createElement('div');
        body.className = 'nav-pet-body';
        body.textContent = '🐳';   // 视频加载失败时的兜底形象
        // 但刷新瞬间视频还没解出第一帧,兜底 emoji 会先露一下再被替换(用户实测的"闪一下 emoji")。
        // 所以先藏起来,只在 error 或 1.2s 看门狗超时时才显示。
        body.style.display = 'none';
        const video = document.createElement('video');
        video.className = 'nav-pet-video';
        video.autoplay = true; video.muted = true; video.loop = true;
        video.setAttribute('playsinline', '');
        pet.append(bubble, body, video);
        // 点气泡空白处立即收起(卡片里的按钮不受影响);不冒泡到宠物,免得又触发点击回应
        bubble.addEventListener('click', function(ev) {
            ev.stopPropagation();
            if (ev.target.closest('button')) return;
            bubble.classList.add('d-none');
            clearTimeout(petBubbleT);
        });
        // 默认右下角(2026-11-18 修):原来的 innerWidth - 88 是照 #navPet 的 64px 盒宽算的,
        // 但视频实际宽是 size(默认 128),出厂位置就右溢出 40px,体型越大越离谱(448 时几乎整只在屏外)。
        // 这就是「桌宠跑到右下角外面、看不见」的直接原因 —— 一律按真实视频宽高留 8px 边距。
        const defSize = parseInt(localStorage.getItem('navPetSize'), 10) || petTier().size;
        const defVh = Math.round(defSize * 0.5625);   // 16:9 素材
        const defLeft = Math.max(8, window.innerWidth - defSize - 8);
        const defTop = Math.max(52, window.innerHeight - defVh - 8);
        let storedX = parseFloat(localStorage.getItem('navPetX'));
        let storedY = parseFloat(localStorage.getItem('navPetY'));
        // 缺值/坏值才回默认。贴边半隐是负坐标、超右是半只在外,都是刻意的吸附姿态,不能清掉
        // (旧代码把「宽屏下 X<200」一律重置,左吸附位存在 -size/2,一刷新就被扔回右下角)。
        if (!isFinite(storedX)) storedX = defLeft;
        if (!isFinite(storedY)) storedY = defTop;
        pet.style.left = storedX + 'px';
        pet.style.top = storedY + 'px';
        document.body.appendChild(pet);
        // 外观:大小/透明度(右键→宠物设置可调,存本机;默认 128,用户实测 96 偏小)
        function petApplyLook() {
            const ui = petApplyUiScale();
            const size = parseInt(localStorage.getItem('navPetSize'), 10) || petTier().size;
            const op = parseFloat(localStorage.getItem('navPetOpacity'));
            video.style.width = size + 'px';
            body.style.fontSize = Math.max(24, Math.round(size * 0.35)) + 'px';
            pet.style.opacity = isNaN(op) ? 1 : op;
            pet.classList.toggle('nav-pet-calm', localStorage.getItem('navPetCalm') === '1');   // 减少动态
            const bs = parseFloat(localStorage.getItem('navPetBubbleScale'));
            bubble.style.fontSize = (0.75 * (isNaN(bs) || bs <= 0 ? 1 : Math.min(1.6, Math.max(0.6, bs))) * ui) + 'rem';   // 气泡缩放 × 界面字号
            petApplyShopLook();   // 金色滤镜 + 帽子(积分商店)
            petClampToView();     // 体型改了也顺手收一次越界(看门狗判据见下)
        }
        // 越界回收(2026-11-18):节点还在、位置却在可视区外时,用户只会说「桌宠消失了」。
        // 判据用「露出来够不够点得到」而不是「坐标在不在框内」—— 贴边半隐(负坐标/半只在外)、
        // 挂顶栏都是刻意姿态,不能被这里拉回来,否则吸附交互就废了。
        // 只有几乎整只在屏外(换显示器/缩放/改窗口尺寸后)才回默认右下角。
        function petClampToView() {
            const size = parseInt(localStorage.getItem('navPetSize'), 10) || petTier().size;
            const vh = Math.round(size * 0.5625);
            const W = window.innerWidth, H = window.innerHeight;
            const curX = parseFloat(pet.style.left) || 0;
            const curY = parseFloat(pet.style.top) || 0;
            const visW = Math.min(W, curX + size) - Math.max(0, curX);
            const visH = Math.min(H, curY + vh) - Math.max(52, curY);
            if (visW >= 40 && visH >= 32) return;   // 40×32 已经够点到了,不动用户摆的位置
            pet.style.left = Math.max(8, W - size - 8) + 'px';
            pet.style.top = Math.max(52, H - vh - 8) + 'px';
        }
        pet._petClampToView = petClampToView;
        pet._petApplyLook = petApplyLook;
        petApplyLook();
        // 浏览器缩放会改 devicePixelRatio,自动字号要跟着重算(防抖,别在拖窗口时狂跑)
        let petUiScaleT = null;
        window.addEventListener('resize', function() {
            clearTimeout(petUiScaleT);
            petUiScaleT = setTimeout(function() {
                if (pet._petApplyLook) pet._petApplyLook(); else petApplyUiScale();
            }, 160);
        });
        pet._petPlay = function(kind) {
            const pool = PET_POOL[kind] || PET_POOL.idle;
            pet._petPlayName(petPickAnim(pool) || pool[0]);   // 加权抽取:不连着播同一条
            if (kind === 'idle') video.loop = true; else video.removeAttribute('loop');
        };
        // 按名字点播(弹窗用):idle 池循环,播完自动回待机;切换时淡入(蒸馏 dsh-pet 双缓冲)
        pet._petPlayName = function(name) {
            pet._curAnim = name;   // 播完接 cue 要看上一条是什么
            video.style.opacity = '0';
            // 上一次加载失败会把 video 藏成 emoji 兜底;不复位的话,下次加载成功后
            // canplay 又把兜底藏掉 → video 和 body 双隐,宠物整个消失(2026-10-06 修复)
            video.style.display = '';
            video.src = '/static/pet/' + encodeURIComponent(name) + '.webm';
            if (PET_POOL.idle.indexOf(name) >= 0) video.loop = true; else video.removeAttribute('loop');
            video.playbackRate = Math.min(2, Math.max(0.5, parseFloat(localStorage.getItem('navPetSpeed')) || 1));   // 播放速度
            const tryPlay = function() { const p = video.play(); if (p && p.catch) p.catch(function() {}); };
            tryPlay();
            // src 切换瞬间的 play() 可能被 AbortError 打断(吞掉后视频停在第 0 帧不动):
            // 半秒后仍未在播就补一次(真浏览器验证发现,ended→idle 快速换源时可复现)
            setTimeout(function() { if (video.paused && !video.ended) tryPlay(); }, 500);
        };
        video.addEventListener('canplay', function() {
            video._ok = true; body.style.display = 'none';   // 视频就绪后隐藏 emoji 兜底
        });
        // 播完是唯一的推进信号(蒸馏 dsh-pet decideEndedCue):睡觉三段靠它接力
        video.addEventListener('ended', function() {
            if (bfHold) return;   // 吃白饭玩法自己按相位推进,中央处理不插手
            const p = document.getElementById('navPet');
            // 多段演出(吃白饭 5 段):播完紧接着下一段,全部播完才回待机
            if (p && !p.dataset.sleeping && p.dataset.seqPlaying === '1') {
                if (petSeq && petSeq.names.length) { p._petPlayName(petSeq.names.shift()); return; }
                delete p.dataset.seqPlaying;
                const done = petSeq && petSeq.onDone;
                petSeq = null;
                if (done) done();
                p._petPlay('idle');
                return;
            }
            const phase = p && p.dataset.sleepPhase;
            if (phase === 'entering') {                 // 睡下播完 → 切睡觉循环
                p.dataset.sleepPhase = 'looping';
                p._petPlayName(PET_SLEEP.loop);
                video.loop = true;
                return;
            }
            if (phase === 'waking') {                   // 起来播完 → 清标记回待机
                delete p.dataset.sleepPhase;
                delete p.dataset.sleeping;
                delete p.dataset.manualSleep;
                p._petPlay('idle');
                return;
            }
            if (p && p.dataset.sleeping === '1') {      // 循环阶段被外来动画顶掉:重新点名循环,别停在别的动作里
                p.dataset.sleepPhase = 'looping';
                p._petPlayName(PET_SLEEP.loop);
                video.loop = true;
                return;
            }
            if (p) delete p.dataset.sleepPhase;   // 普通动画播完:顺手清掉可能残留的睡眠阶段
            // 播完接 cue:几条收尾动作接一个指定后续(上游 cues.ts 的最小版),避免每段都回同一姿势
            const curAnim = p && p._curAnim;
            const cue = curAnim && PET_CUES[curAnim];
            if (cue && !p.dataset.sleeping && !window.petBaifanBusy) {
                p._petPlayName(cue);
                return;
            }
            pet._petPlay('idle');
        });
        // emoji 只是"视频挂了"的兜底,不是"加载中"的占位 —— 所以只在真出错时露出来。
        // (2026-11-14:曾经加过 1.2s 看门狗,弱网/后台标签页里视频解不出第一帧时会先闪一下
        //  emoji 再切回视频,就是用户反馈的那个"刷新刚打开是 emoji"。)
        video.addEventListener('error', function() { video.style.display = 'none'; body.style.display = ''; });
        video.addEventListener('playing', function() { video.style.opacity = ''; });   // 淡入完成
        pet._petPlay('idle');
        // 点击:说话 + Q 弹挤压 + 回应动画(拖拽超过阈值不算点击)
        function petSquash() {
            const target = video.style.display !== 'none' ? video : body;
            target.classList.remove('nav-pet-squash'); void target.offsetWidth;
            target.classList.add('nav-pet-squash');
            target.addEventListener('animationend', function h() {
                target.classList.remove('nav-pet-squash');
                target.removeEventListener('animationend', h);
            });
        }
        let petClicks = [], longPressT = null, longPressFired = false, hoverT = null, petHoverCd = 0;
        pet.addEventListener('click', function() {
            if (pet.dataset.skipClick === '1') { delete pet.dataset.skipClick; return; }
            if (longPressFired) { longPressFired = false; return; }   // 长按表情包后紧跟的 click 不再说话
            // 吸附状态点击弹出(兑现"点我出来~";吸附位是半隐负坐标/超右坐标)
            const vwNow = video.getBoundingClientRect().width || 128;
            const curL = parseFloat(pet.style.left) || 0;
            const curT = parseFloat(pet.style.top) || 0;
            if (curL < 0 || curL + vwNow > window.innerWidth || curT <= 56) {
                pet.style.left = Math.max(8, Math.round(window.innerWidth / 2 - vwNow / 2)) + 'px';
                pet.style.top = Math.round(window.innerHeight * 0.55) + 'px';
                petSay('我出来啦~', 1800);
                petSquash();
                petBeep('pickup');
                return;
            }
            // 睡着时点一下 = 叫醒(播「起来」)。已在起身中就别重播,只补一下 Q 弹
            if (pet.dataset.sleeping === '1') {
                if (pet.dataset.sleepPhase !== 'waking') petWake();
                petSquash();
                return;
            }
            delete pet.dataset.sleeping;
            delete pet.dataset.manualSleep;
            // 连击彩蛋:3 秒内戳满 5 次,傲娇生气
            const now = Date.now();
            petClicks = petClicks.filter(function(t) { return now - t < 3000; });
            petClicks.push(now);
            if (petClicks.length >= 5) {
                petClicks = [];
                pet._petPlayName('点击回应-傲娇生气');
                petSay('别戳了!再戳真生气了!', 2400);
                petSquash();
                petBeep('pop');
                const v5 = petVitals();
                v5.mood = Math.min(100, v5.mood + 4);
                petVitalsSave(v5);
                petScoreAdd(3);
                return;
            }
            // 单击桌宠 = 进入 AI 对话：默认弹出快捷输入，聊天窗口模式反之。
            // 延迟 220ms 是给双击“报家底”留出判定窗口，双击会取消这次 AI 打开。
            // 放在抽签分支之前，保证当天第一次点击也能直接进入对话。
            if (pet._aiOpenTimer) clearTimeout(pet._aiOpenTimer);
            pet._aiOpenTimer = setTimeout(function() {
                pet._aiOpenTimer = null;
                // 访客态不开 AI 对话窗:AI 接口/聊天/记忆都在服务端,这里回落本地语录。
                if (window.NAV_GUEST_MODE) { petSay(); return; }
                if (window.petAiChatOpen) window.petAiChatOpen();
            }, 220);
            const f = petFortuneOfDay();
            if (f.fresh) {   // 每天第一次点:今日运势(在线诗词优先)+ 彩蛋动画
                try {
                    const sf = JSON.parse(localStorage.getItem('navPetFortune') || 'null');
                    if (sf) { sf.fresh = false; localStorage.setItem('navPetFortune', JSON.stringify(sf)); }
                } catch (e) {}
                petSay('🔮 抽签中…', 1500);
                const showFortune = function(text, tail) {
                    petSay('🔮 ' + text + (tail ? ' —— ' + tail : ''), 6000);
                    if (f.anim) petPlayByName(f.anim);
                    petBeep('greet');
                };
                const localShow = function() {
                    showFortune(f.text, '');
                };
                // 今日诗词(免费免 key):诗句+出处;失败再试一言,再失败回落本地运势
                fetch('https://v1.jinrishici.com/all')
                    .then(function(r) { return r.json(); })
                    .then(function(d) {
                        if (d && d.content) { showFortune(d.content, (d.author || '') + '《' + (d.origin || '') + '》'); return; }
                        throw new Error('empty');
                    })
                    .catch(function() {
                        return fetch('https://international.v1.hitokoto.cn/?c=i&c=k')
                            .then(function(r) { return r.json(); })
                            .then(function(d) {
                                if (d && d.hitokoto) { showFortune(d.hitokoto, (d.from_who || '') + (d.from ? '《' + d.from + '》' : '')); return; }
                                throw new Error('empty');
                            });
                    })
                    .catch(localShow);
                return;
            }
            pet._petPlay('click');
            petSay();
            petSquash();
            petBeep('click');
            const v = petVitals();   // 逗乐:心情小涨
            v.mood = Math.min(100, v.mood + 2);
            petVitalsSave(v);
            petScoreAdd(1);
        });
        // 悬停 1.5 秒:轻量问好(60 秒冷却,不播动画不打扰)
        pet.addEventListener('mouseenter', function() {
            hoverT = setTimeout(function() {
                if (Date.now() - petHoverCd < 60000) return;
                petHoverCd = Date.now();
                petSay('我在哦~ 右键还有菜单', 2200);
            }, 1500);
        });
        pet.addEventListener('mouseleave', function() { clearTimeout(hoverT); });
        // 拖拽:弹簧跟手 + 松手惯性滑行、边界反弹(蒸馏 dsh-pet 手感),位置存本机
        let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0, moved = 0, lastEx = 0, lastEy = 0, vx = 0, vy = 0;
        // ===== 抛掷 / 弹弓物理(蒸馏 dsh-pet shared/physics:release + throw)=====
        // 甩抛初速取最近 150ms 轨迹(端点均值 + 窗口峰值加权),低于 500px/s 视为原地放下;
        // 重力 1400、反弹 0.78、落地摩擦 2.5/s;一帧按 8px 位移拆子步,避免高速时跨过落地与反弹帧。
        // 双按 <200ms 进弹弓:力度只看拉距(拉距 / 宠物宽×0.6),与手速无关。
        const PET_PHYS = {
            g: 1400, e: 0.78, friction: 2.5, restN: 40, restT: 15,
            maxDt: 0.05, substepPx: 8, substepMax: 64,
            deadZone: 500, winMs: 150, staleMs: 150, refRatio: 0.6, speedAnchor: 1200
        };
        let petTrail = [], petLastDownAt = 0, petSlingAnchor = null, petTiltG = null;
        function petHaptic(ms) {
            if (localStorage.getItem('navPetHaptic') === '0' || !navigator.vibrate) return;
            try { navigator.vibrate(ms || 10); } catch (e) {}
        }
        // 设备倾斜当重力:手机才有传感器,桌面保持竖直向下。默认关,localStorage navPetTilt=1 打开
        if (localStorage.getItem('navPetTilt') === '1' && window.DeviceOrientationEvent) {
            window.addEventListener('deviceorientation', function(ev) {
                if (ev.gamma == null || ev.beta == null) return;
                const gx = Math.max(-1, Math.min(1, ev.gamma / 45));
                const gy = Math.max(0.2, Math.min(1, (ev.beta - 30) / 60 + 0.5));
                petTiltG = { x: gx * PET_PHYS.g * 0.7, y: gy * PET_PHYS.g };
            });
        }
        function petGravity() { return petTiltG || { x: 0, y: PET_PHYS.g }; }
        function petSoftClamp(speed) {
            if (speed <= 0) return 0;
            return 3600 * (1 - Math.exp(-speed / 3600));
        }
        // 甩抛初速估算(同上游 estimateReleaseVelocity 的口径,去掉加速度增益那段)
        function petReleaseVelocity(trail, now) {
            if (!trail.length) return null;
            const last = trail[trail.length - 1];
            if (now - last.t > PET_PHYS.staleMs) return null;      // 松手前停顿:温柔放下
            const win = trail.filter(function(s) { return now - s.t <= PET_PHYS.winMs; });
            if (win.length < 2) return null;
            const t0 = win[0].t, x0 = win[0].x, y0 = win[0].y;
            const span = last.t - t0;
            if (span < 20) return null;
            const bvx = (last.x - x0) / span * 1000, bvy = (last.y - y0) / span * 1000;
            const base = Math.hypot(bvx, bvy);
            if (base < 1e-6) return null;
            let peak = base, px = x0, py = y0, pt = t0;
            for (let i = 1; i < win.length; i++) {
                const s = win[i], dt = s.t - pt;
                if (dt >= 8) {
                    peak = Math.max(peak, Math.hypot(s.x - px, s.y - py) / dt * 1000);
                    px = s.x; py = s.y; pt = s.t;
                }
            }
            const speed = petSoftClamp(0.5 * base + 0.5 * peak);
            if (speed < PET_PHYS.deadZone) return null;            // 死区:不抛,原地放下
            return { vx: bvx / base * speed, vy: bvy / base * speed };
        }
        // 弹弓:力度 = 拉距 / (宠物宽 × 0.6),方向 = 拉的反方向,不设上限(拉得远与更远必须能区分)
        function petSlingVelocity(pullX, pullY, size) {
            const dist = Math.hypot(pullX, pullY);
            const ref = size > 0 ? size * PET_PHYS.refRatio : 0;
            if (!(ref > 0) || dist <= 6) return null;
            const power = dist / ref;
            const speed = PET_PHYS.speedAnchor * power;
            const angle = Math.atan2(pullY, -pullX);
            return { vx: Math.cos(angle) * speed, vy: -Math.sin(angle) * speed, power: power };
        }
        // 飞行:重力 + 四面反弹 + 落地摩擦 + 落地 Q 弹/震动,静止后回待机并存位置
        function petFlight(v0x, v0y) {
            let x = parseFloat(pet.style.left) || 0, y = parseFloat(pet.style.top) || 0;
            let vx = v0x, vy = v0y, lastT = performance.now();
            // 尺寸在起飞时定格:落地 Q 弹改的是 transform,逐帧读 rect 会让边界跟着跳,永远判不了静止
            const vw = video.getBoundingClientRect().width || 128, vh = vw * 0.5625;
            const minX = 4, maxX = window.innerWidth - vw - 4;
            const minY = 52, maxY = window.innerHeight - vh - 4;
            const startT = lastT;
            pet.dataset.flying = '1';
            function frame(ts) {
                const dt = Math.min(PET_PHYS.maxDt, Math.max(0, (ts - lastT) / 1000));
                lastT = ts;
                if (dt <= 0) { requestAnimationFrame(frame); return; }
                const sub = Math.max(1, Math.min(PET_PHYS.substepMax,
                    Math.ceil(Math.max(Math.abs(vx), Math.abs(vy)) * dt / PET_PHYS.substepPx)));
                const sdt = dt / sub;
                let hit = false, bounce = false;
                for (let i = 0; i < sub; i++) {
                    const g = petGravity();
                    vx += g.x * sdt; vy += g.y * sdt;
                    x += vx * sdt; y += vy * sdt;
                    if (x < minX) { x = minX; if (Math.abs(vx) > PET_PHYS.restN) { vx = -vx * PET_PHYS.e; hit = true; } else vx = 0; }
                    if (x > maxX) { x = maxX; if (Math.abs(vx) > PET_PHYS.restN) { vx = -vx * PET_PHYS.e; hit = true; } else vx = 0; }
                    if (y < minY) { y = minY; if (Math.abs(vy) > PET_PHYS.restN) { vy = -vy * PET_PHYS.e; hit = true; } else vy = 0; }
                    if (y > maxY) {
                        y = maxY;
                        if (Math.abs(vy) > PET_PHYS.restN) { vy = -vy * PET_PHYS.e; hit = true; bounce = true; }
                        else vy = 0;
                        vx *= Math.exp(-PET_PHYS.friction * sdt);   // 落地摩擦:水平速度按 2.5/s 衰减
                    }
                }
                pet.style.left = Math.round(x) + 'px';
                pet.style.top = Math.round(y) + 'px';
                if (hit) { petHaptic(8); if (bounce) petSquash(); }
                if (bounce) petBeep('land');
                const atRest = (y >= maxY - 2 && Math.abs(vy) < PET_PHYS.restT && Math.abs(vx) < PET_PHYS.restT)
                    || performance.now() - startT > 12000;   // 兜底:别让极端参数把宠物永远挂在飞行里
                if (atRest) {
                    delete pet.dataset.flying;
                    localStorage.setItem('navPetX', Math.round(x));
                    localStorage.setItem('navPetY', Math.round(y));
                    if (pet._petPlay) pet._petPlay('idle');
                    return;
                }
                requestAnimationFrame(frame);
            }
            requestAnimationFrame(frame);
        }
        pet.addEventListener('mousedown', function(e) {
            // 叫醒只在「真拖」或「点击」时发生:这里不叫醒,否则 mouseup 会先把睡眠标记清掉、click 就当成普通点击了
            if (window.petBaifanBusy && window.petBaifanHalt) window.petBaifanHalt();   // 抓走 = 打断吃白饭(对应上游 Halted)
            dragging = true; moved = 0; vx = vy = 0;
            // 双按 <200ms = 弹弓:取按下时的宠物中心当锚点,松手时按拉距换算力度
            const nowMs = performance.now();
            const isSling = petLastDownAt > 0 && (nowMs - petLastDownAt) < 200;
            petLastDownAt = nowMs;
            petTrail = [];
            if (isSling) {
                const vw0 = video.getBoundingClientRect().width || 128;
                petSlingAnchor = {
                    x: (parseFloat(pet.style.left) || 0) + vw0 / 2,
                    y: (parseFloat(pet.style.top) || 0) + vw0 * 0.5625 / 2
                };
                petBeep('sling');
                petSay('拉满松手,发射!', 1600);
            } else {
                petSlingAnchor = null;
            }
            delete pet.dataset.dragPlayed;
            pet.style.transition = '';   // 打断散步滑行
            lastEx = e.clientX; lastEy = e.clientY;
            sx = e.clientX; sy = e.clientY;
            ox = parseInt(pet.style.left, 10) || Math.max(16, window.innerWidth - 88);
            oy = parseInt(pet.style.top, 10) || Math.max(60, window.innerHeight - 100);
            // 长按 600ms(原地不动):直接来一张表情包(弹弓那一下不触发)
            if (e.button === 0 && !isSling) {
                longPressT = setTimeout(function() {
                    longPressFired = true;
                    petMeme();
                    petBeep('pop');
                }, 600);
            }
        });
        const onDragMove = function(e) {
            if (!dragging) return;
            vx = e.clientX - lastEx; vy = e.clientY - lastEy;   // 记最后速度(旧的每事件增量,弹弓/甩抛改看轨迹)
            lastEx = e.clientX; lastEy = e.clientY;
            petTrail.push({ t: performance.now(), x: e.clientX, y: e.clientY });   // 松手估算初速用
            if (petTrail.length > 40) petTrail.shift();
            const vw = video.getBoundingClientRect().width || 128;
            const vh = vw * 0.5625;   // 16:9 素材
            const nx = Math.max(0, Math.min(window.innerWidth - vw, ox + e.clientX - sx));
            const ny = Math.max(52, Math.min(window.innerHeight - vh - 4, oy + e.clientY - sy));
            moved = Math.max(moved, Math.abs(nx - ox), Math.abs(ny - oy));
            if (moved > 8 && !pet.dataset.dragPlayed) {
                clearTimeout(longPressT);   // 拖起来了,长按作废
                pet.dataset.dragPlayed = '1';   // 被抓起来:悬空挣扎动画循环,松手解除(dsh-pet 专属拖拽素材)
                pet._petPlayName(PET_POOL.drag[0]);
                video.loop = true;
                petBeep('pickup');
            }
            pet.style.left = nx + 'px'; pet.style.top = ny + 'px';
        };
        const onDragUp = function() {
            if (!dragging) return;
            dragging = false;
            clearTimeout(longPressT);   // 长按作废(拖拽或原地松手都取消)
            if (pet.dataset.dragPlayed) video.removeAttribute('loop');   // 松手:悬空动画播完回待机
            // 只有真拖动才算「抓一下就醒」;原地松手是点击,睡眠标记留给 click 处理(由 petWake 播「起来」)
            if (moved > 8 && pet.dataset.sleepPhase !== 'waking') {
                delete pet.dataset.sleeping;
                delete pet.dataset.manualSleep;
                delete pet.dataset.sleepPhase;
            }
            if (moved > 8) pet.dataset.skipClick = '1';   // 拖过的位移不算点击
            // 松手结算:弹弓(双按)看拉距,否则按最近轨迹估初速;都不满足就原地放下
            if (moved > 8) {
                let rel = null;
                if (petSlingAnchor) {
                    const vw0 = video.getBoundingClientRect().width || 128;
                    const vh0 = vw0 * 0.5625;
                    const cx = (parseFloat(pet.style.left) || 0) + vw0 / 2;
                    const cy = (parseFloat(pet.style.top) || 0) + vh0 / 2;
                    rel = petSlingVelocity(cx - petSlingAnchor.x, cy - petSlingAnchor.y, vw0);
                } else {
                    rel = petReleaseVelocity(petTrail, performance.now());
                }
                petSlingAnchor = null;
                if (rel && (Math.abs(rel.vx) > 0.5 || Math.abs(rel.vy) > 0.5)) {
                    petBeep(rel.power ? 'sling' : 'whoosh');
                    pet.dataset.skipClick = '1';
                    petFlight(rel.vx, rel.vy);
                    return;
                }
            }
            // 拖到左右边缘:半隐探头吸附(dsh-pet 经典交互),点露出的部分弹出
            const vw = video.getBoundingClientRect().width || 128;
            const curX = parseFloat(pet.style.left) || 0;
            const curY = parseFloat(pet.style.top) || 0;
            if (curY <= 80) {                                // 拖到顶栏:挂在上沿晃悠
                pet.style.top = '54px';
                pet.dataset.skipClick = '0';
                petSay('挂在顶栏上啦,点我下来~', 2000);
            } else if (curX < 28) {
                pet.style.left = (-vw / 2) + 'px';           // 恰好藏起一半视频
                pet.dataset.skipClick = '0';                 // 不吃掉下一次点击:点了就弹出
                petSay('我躲好了,点我出来~', 2000);
            } else if (curX + vw > window.innerWidth - 28) {
                pet.style.left = (window.innerWidth - vw / 2) + 'px';
                pet.dataset.skipClick = '0';
                petSay('我躲好了,点我出来~', 2000);
            }
            // 注意:位置可能恰好是 0(或负的吸附位),不能用 || 默认值
            const px = parseInt(pet.style.left, 10);
            const py = parseInt(pet.style.top, 10);
            if (!isNaN(px)) localStorage.setItem('navPetX', px);
            if (!isNaN(py)) localStorage.setItem('navPetY', py);
        };
        if (petDocMove) document.removeEventListener('mousemove', petDocMove);
        if (petDocUp) document.removeEventListener('mouseup', petDocUp);
        petDocMove = onDragMove; petDocUp = onDragUp;
        document.addEventListener('mousemove', onDragMove);
        document.addEventListener('mouseup', onDragUp);
    }
    navPetMount();
    // 视口变化(缩窗口/换显示器/改缩放)后,存档坐标可能已经落到屏外 —— 挂载时收一次,这里也收一次。
    // 监听器只挂这一个(不随开关重挂),每次现取 #navPet,免得开关几次就积一堆。
    window.addEventListener('resize', function() {
        const p = document.getElementById('navPet');
        if (p && p._petClampToView) p._petClampToView();
    }, { passive: true });
    // ===== 8bit 音效(Web Audio 方波合成,零素材;桌面宠物的声音反馈) =====
    let petAudioCtx = null, petGestured = false;
    document.addEventListener('pointerdown', function() { petGestured = true; }, { once: true, capture: true });
    function petBeep(kind) {
        if (localStorage.getItem('navPetSound') === '0' || !petGestured) return;   // 浏览器要求手势解锁音频
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            if (!petAudioCtx) petAudioCtx = new AC();
            const ctx = petAudioCtx;
            if (ctx.state !== 'running') { ctx.resume(); return; }   // 未解锁不排队,避免迟到爆音
            const vol = Math.min(1, Math.max(0.05, parseFloat(localStorage.getItem('navPetSoundVol')) || 0.3)) * 0.4;
            const tones = {
                click: [[660, 0, .06]],
                pickup: [[440, 0, .05], [660, .05, .05], [880, .1, .07]],
                whoosh: [[880, 0, .16], [220, .04, .18]],
                sling: [[196, 0, .1], [392, .08, .12]],   // 弹弓:低频上挑
                land: [[330, 0, .05], [165, .05, .08]],   // 落地闷响
                sleep: [[523, 0, .12], [392, .14, .18]],
                pop: [[988, 0, .05], [1319, .06, .08]],
                greet: [[523, 0, .09], [659, .1, .09], [784, .2, .14]],
                ding: [[784, 0, .08], [1047, .09, .16]]
            }[kind] || [[660, 0, .06]];
            const t0 = ctx.currentTime;
            const gain = ctx.createGain();
            gain.connect(ctx.destination);
            gain.gain.setValueAtTime(vol, t0);
            let end = 0;
            const moodK = 0.9 + (petVitals().mood / 100) * 0.25;   // 心情越好音调越亮
            tones.forEach(function(tn) {
                const o = ctx.createOscillator();
                o.type = 'square';   // 8bit 芯片音色
                o.frequency.setValueAtTime(Math.round(tn[0] * moodK), t0 + tn[1]);
                o.connect(gain);
                o.start(t0 + tn[1]);
                o.stop(t0 + tn[1] + tn[2] + .02);
                end = Math.max(end, tn[1] + tn[2]);
            });
            gain.gain.setValueAtTime(vol, t0 + end);
            gain.gain.linearRampToValueAtTime(0.0001, t0 + end + .04);
        } catch (e) { /* 音频不可用静默 */ }
    }
    // ===== 说话/统计助手(挂在 IIFE 层:桌宠开关装卸后依然可用,走事件委托) =====
    let petBubbleT = null, petTypeT = null;
    // 开合音效(2026-10-25):弹窗/抽屉/下拉开合时轻微 whoosh;开关 navPetUiSound 默认关
    function petUiSound(kind) {
        if (localStorage.getItem('navPetUiSound') !== '1' || !petGestured) return;
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            if (!petAudioCtx) petAudioCtx = new AC();
            const ctx = petAudioCtx;
            if (ctx.state !== 'running') { ctx.resume(); return; }
            const dur = 0.09;
            const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
            const d = buf.getChannelData(0);
            for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
            const s = ctx.createBufferSource(); s.buffer = buf;
            const f = ctx.createBiquadFilter(); f.type = 'bandpass';
            f.frequency.value = kind === 'open' ? 1400 : 900;   // 开=亮一点,关=闷一点
            f.Q.value = 1.1;
            const g = ctx.createGain();
            g.gain.value = Math.min(1, Math.max(0.05, parseFloat(localStorage.getItem('navPetSoundVol')) || 0.3)) * 0.12;
            s.connect(f); f.connect(g); g.connect(ctx.destination);
            s.start();
        } catch (e) {}
    }
    window.petUiSound = petUiSound;
    window.petNoiseIsPlaying = function(kind) { return petNoiseKind === kind; };
    window.petLanternApply = petLanternApply;   // 节日灯笼(测试/调试取用)
    // 语音朗读(Web Speech API,免 key):开关 navPetSpeak,默认关;后台页不读;过滤 emoji 免得读出来怪怪的
    function petSpeak(text) {
        if (localStorage.getItem('navPetSpeak') !== '1' || document.hidden) return;
        if (!('speechSynthesis' in window)) return;
        try {
            window.speechSynthesis.cancel();
            const plain = Array.from(String(text)).filter(function(ch) {
                const cp = ch.codePointAt(0);
                return !(cp >= 0x1F300 && cp <= 0x1FAFF) && !(cp >= 0x2600 && cp <= 0x27BF) && !(cp >= 0xFE00 && cp <= 0xFE0F);
            }).join('').slice(0, 120);
            if (!plain.trim()) return;
            const u = new SpeechSynthesisUtterance(plain);
            u.lang = 'zh-CN';
            u.rate = 1.05;
            window.speechSynthesis.speak(u);
        } catch (e) { /* 朗读失败不打扰 */ }
    }
    // 白噪音陪伴(2026-10-25 brainstorm):海浪=棕噪+慢涌 LFO,雨声=带通白噪;同 petAudioCtx,零素材
    let petNoiseNodes = null, petNoiseKind = '';
    function petNoiseStop() {
        if (!petNoiseNodes) { petNoiseKind = ''; return; }
        try {
            petNoiseNodes.gain.gain.setTargetAtTime(0, petAudioCtx.currentTime, 0.15);
            const n = petNoiseNodes;
            setTimeout(function() { try { n.src.stop(); } catch (e) {} }, 500);
        } catch (e) {}
        petNoiseNodes = null;
        petNoiseKind = '';
    }
    function petNoiseStart(kind) {
        if (localStorage.getItem('navPetSound') === '0' || !petGestured) {
            petSay('先随便点一下页面(浏览器要手势解锁音频),再开~', 3000);
            return;
        }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        if (!petAudioCtx) petAudioCtx = new AC();
        const ctx = petAudioCtx;
        if (ctx.state !== 'running') { ctx.resume(); }
        petNoiseStop();
        const len = 2 * ctx.sampleRate;
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        let last = 0;
        for (let i = 0; i < len; i++) {   // 棕噪(更闷更像海浪底色)
            const white = Math.random() * 2 - 1;
            last = (last + 0.02 * white) / 1.02;
            data[i] = last * 3.2;
        }
        const srcN = ctx.createBufferSource();
        srcN.buffer = buf; srcN.loop = true;
        const filt = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        const base = Math.min(1, Math.max(0.05, parseFloat(localStorage.getItem('navPetSoundVol')) || 0.3)) * 0.12;
        if (kind === 'rain') {
            filt.type = 'bandpass'; filt.frequency.value = 2400; filt.Q.value = 0.6;
            gain.gain.value = base;
        } else {   // wave:低通 + 慢涌 LFO(约 9 秒一个浪)
            filt.type = 'lowpass'; filt.frequency.value = 620;
            gain.gain.value = base;
            const lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
            lfo.frequency.value = 0.11; lfoGain.gain.value = base * 0.7;
            lfo.connect(lfoGain); lfoGain.connect(gain.gain);
            lfo.start();
            petNoiseNodes = {src: srcN, gain: gain, lfo: lfo};
        }
        if (!petNoiseNodes) petNoiseNodes = {src: srcN, gain: gain};
        srcN.connect(filt); filt.connect(gain); gain.connect(ctx.destination);
        srcN.start();
        petNoiseKind = kind;
        petBeep('pop');
    }
    function petNoiseMenuLabel(kind) {
        return (petNoiseKind === kind ? '⏹ ' : '') + (kind === 'wave' ? '🌊 海浪声' : '🌧 雨声') + (petNoiseKind === kind ? '(播放中)' : '');
    }
    // 气泡脸色(2026-10-25):精力满=亮金,饿了=发灰,无聊=泛蓝;看颜色就知道它状态
    function petMoodColor() {
        const v = petVitals();
        if (v.energy < 25) return '#8d949e';          // 饿/没电:发灰
        if (v.bored > 65) return '#5aa2ff';           // 无聊:泛蓝
        if (v.mood > 65 && v.energy > 55) return '#f0b429';   // 状态好:亮金
        return '';                                     // 一般:默认边框
    }
    function petMoodApply() {
        const b = document.querySelector('#navPet .nav-pet-bubble');
        if (!b) return;
        const c = petMoodColor();
        b.style.borderColor = c || 'var(--bs-border-color)';
        b.style.boxShadow = c ? '0 6px 18px rgba(0,0,0,.18), 0 0 6px ' + c + '66' : '0 6px 18px rgba(0,0,0,.18)';
    }
    function petSay(text, ms, prio) {
        // 气泡槽:高优先级播报在有效期内不被低优先级顶掉(1 碎碎念 / 2 余额 / 3 工作 / 4 待办)
        const p = prio || PET_BUBBLE_PRIO.whisper;
        if (petBubbleUntil > Date.now() && p < petBubblePrio) return false;
        if (!text && petBubbleUntil > Date.now() && petBubblePrio > PET_BUBBLE_PRIO.whisper) return false;   // 随口一句不打断重要播报
        petLastActive = Date.now();   // 说话=活着:任务播报后不被闲置打盹立刻盖掉
        const b = document.querySelector('#navPet .nav-pet-bubble');
        if (!b) return false;
        b.classList.remove('nav-pet-bubble-card');
        const quotes = petTier().quotes || PET_QUOTES;
        const full = text || quotes[Math.floor(Math.random() * quotes.length)];
        petMoodApply();
        petSpeak(full);   // 语音朗读开关(设置里,默认关)
        b.classList.remove('d-none');
        clearTimeout(petBubbleT);
        clearInterval(petTypeT);
        petBubblePrio = p;
        petBubbleUntil = Date.now() + (ms || 2600) + Array.from(full).length * 26;
        if (document.hidden) {   // 页面在后台:没人看,整句直出(后台定时器会被浏览器节流成 1 字/秒)
            b.textContent = full;
            setTimeout(function() { b.classList.add('d-none'); petBubblePrio = 0; petBubbleUntil = 0; }, (ms || 2600) + 200);
        } else {
            const chars = Array.from(full);   // 码点安全,不劈碎 emoji
            let i = 0;
            b.textContent = '';
            petTypeT = setInterval(function() {
                i += 1;
                b.textContent = chars.slice(0, i).join('');
                if (i >= chars.length) clearInterval(petTypeT);
            }, 26);   // 打字机效果
            petBubbleT = setTimeout(function() {
                b.classList.add('d-none');
                petBubblePrio = 0;
                petBubbleUntil = 0;
            }, (ms || 2600) + chars.length * 26);
        }
        return true;
    }
    function petStats() {   // 报家底:收录/星标/最近使用都是现成数据
        const sites = document.querySelectorAll('.nav-hub [data-site-item]').length;
        const stars = navLsGet('navStars').filter(Boolean).length;
        const recents = navLsGet('navRecent').filter(Boolean).length;
        petSay('已收录 ' + sites + ' 个站点 · 星标 ' + stars + ' · 最近使用 ' + recents + ' 条', 3200);
    }
    // 散步(蒸馏 dsh-pet 屏幕漫游的网页版):播走路动画循环 + 滑到可视区随机处停稳存档,拖拽可打断
    let petWalkT = null;
    function petWalk() {
        const pet = document.getElementById('navPet');
        if (!pet) return;
        const size = parseInt(localStorage.getItem('navPetSize'), 10) || petTier().size;
        const nx = Math.round(16 + Math.random() * Math.max(60, window.innerWidth - size - 32));
        const ny = Math.round(52 + Math.random() * Math.max(60, window.innerHeight - size - 110));
        petPlayByName(petPickAnim(PET_POOL.walk));
        const video = pet.querySelector('.nav-pet-video');
        if (video) video.loop = true;   // 走路循环,到站收工回待机
        pet.style.transition = 'left 4.5s ease-in-out, top 4.5s ease-in-out';
        pet.style.left = nx + 'px'; pet.style.top = ny + 'px';
        petSay('我去逛逛~', 2000);
        clearTimeout(petWalkT);
        petWalkT = setTimeout(function() {
            pet.style.transition = '';
            const v = document.querySelector('#navPet .nav-pet-video');
            if (v) v.removeAttribute('loop');
            const px = parseInt(pet.style.left, 10), py = parseInt(pet.style.top, 10);
            if (!isNaN(px)) localStorage.setItem('navPetX', px);
            if (!isNaN(py)) localStorage.setItem('navPetY', py);
            petBeep('ding');
        }, 4600);
    }
    // 钓鱼(2026-10-25 brainstorm 落地):走到屏幕底边抛竿,随机渔获;纯本机
    let petFishBusy = false;
    function petFish() {
        const pet = document.getElementById('navPet');
        if (!pet || petFishBusy) { if (petFishBusy) petSay('钓着呢,别催~', 1800); return; }
        petFishBusy = true;
        delete pet.dataset.sleeping; delete pet.dataset.manualSleep;
        const vw = parseFloat(pet.querySelector('.nav-pet-video') ? pet.querySelector('.nav-pet-video').style.width : '') || petTier().size;
        const nx = Math.round(16 + Math.random() * Math.max(60, window.innerWidth - vw - 32));
        const ny = Math.max(52, window.innerHeight - vw * 0.5625 - 8);
        petPlayByName(petPickAnim(PET_POOL.walk));
        const video = pet.querySelector('.nav-pet-video');
        if (video) video.loop = true;
        pet.style.transition = 'left 3.5s ease-in-out, top 3.5s ease-in-out';
        pet.style.left = nx + 'px'; pet.style.top = ny + 'px';
        petSay('🎣 去水边钓一会儿…', 3200);
        setTimeout(function() {
            pet.style.transition = '';
            const v = pet.querySelector('.nav-pet-video');
            if (v) { v.removeAttribute('loop'); }
            petPlayByName('用鲸鱼尾巴拍打地面');   // 甩竿待鱼
            petSay('🎣 抛竿中…嘘,有耐心', 2600);
            setTimeout(function() {
                const roll = Math.random();
                if (roll < 0.42) {
                    petScoreAdd(10);
                    petPlayByName(petPickAnim(PET_POOL.eat));
                    petSay('🐟 钓到一条肥鱼!美餐一顿,+10 分', 3600);
                    petBeep('ding');
                } else if (roll < 0.62) {
                    petPlayByName('东张西望');
                    petSay('🥾 只捞到一只旧靴子…谁扔的!', 3400);
                    petBeep('pop');
                } else if (roll < 0.85) {
                    petPlayByName('拆礼物');
                    petBeep('ding');
                    const gift = Math.random();
                    if (gift < 0.4) {
                        petScoreAdd(30);
                        petSay('🎁 宝箱!里面是 30 分!', 3600);
                    } else if (gift < 0.7) {
                        petMeme();
                        petSay('🎁 宝箱里藏着一张表情包!', 3200);
                    } else {
                        petSay('🎁 宝箱里是一张藏宝图…我看看今天哪站你没逛过~', 3600);
                        setTimeout(function() { petSuggest(); }, 1200);
                    }
                } else {
                    petPlayByName('哈欠连天');
                    petSay('💨 空钩…今天鱼不咬,改天再来', 3200);
                }
                const px = parseInt(pet.style.left, 10), py = parseInt(pet.style.top, 10);
                if (!isNaN(px)) localStorage.setItem('navPetX', px);
                if (!isNaN(py)) localStorage.setItem('navPetY', py);
                petFishBusy = false;
            }, 2500 + Math.random() * 2500);
        }, 3600);
    }
    // 打个盹:三段接力(睡下 → 循环 → 起来)。睡着期间点它=叫醒,拖它=顺手叫醒再拖。
    function petSleep(auto) {
        const pet = document.getElementById('navPet');
        if (!pet || !pet._petPlayName) return;
        if (pet.dataset.sleeping === '1') return;          // 已经在睡,不重播睡下
        pet.dataset.sleeping = '1';
        pet.dataset.sleepPhase = 'entering';
        if (!auto) pet.dataset.manualSleep = '1';          // 手动打盹:动鼠标不吵醒,点它才醒
        pet._petPlayName(PET_SLEEP.start);
        const video = pet.querySelector('.nav-pet-video');
        if (video) video.removeAttribute('loop');          // 睡下只播一遍,播完在 ended 里接循环
        petSay(auto ? '没事做,我先睡一觉,动动我就醒' : '嘘…我睡一会儿,点我就醒', 2400);
        petBeep('sleep');
    }
    // 叫醒:播「起来」,播完回待机(入睡过渡中被叫醒不播起来,直接回待机 —— 与上游不变量一致)
    function petWake(quiet) {
        const pet = document.getElementById('navPet');
        if (!pet || pet.dataset.sleeping !== '1') return false;
        delete pet.dataset.manualSleep;
        if (pet.dataset.sleepPhase === 'entering') {       // 还没躺平,别播起身
            delete pet.dataset.sleepPhase;
            delete pet.dataset.sleeping;
            pet._petPlay('idle');
            if (!quiet) petSay('还没睡呢~', 1500);
            return true;
        }
        pet.dataset.sleepPhase = 'waking';
        pet._petPlayName(PET_SLEEP.end);
        const video = pet.querySelector('.nav-pet-video');
        if (video) video.removeAttribute('loop');
        if (!quiet) petSay('唔…醒了醒了', 1600);
        petBeep('greet');
        return true;
    }
    window.petSleep = petSleep;
    window.petWake = petWake;
    // 表情包:宠物身边随机展示一张 dsh-pet memes PNG,3.5 秒自动收起
    let petMemeT = null;
    function petMeme(name) {
        const pet = document.getElementById('navPet');
        if (!pet) return;
        let img = document.getElementById('navPetMeme');
        if (!img) {
            img = document.createElement('img');
            img.id = 'navPetMeme';
            img.alt = '';
            img.className = 'd-none';
            document.body.appendChild(img);
        }
        const meme = (name && PET_MEMES.indexOf(name) !== -1) ? name
            : PET_MEMES[Math.floor(Math.random() * PET_MEMES.length)];
        img.src = '/static/pet/memes/' + encodeURIComponent(meme) + '.png';
        const pr = pet.getBoundingClientRect();
        img.style.left = Math.max(8, Math.min(pr.right + 10, window.innerWidth - 200)) + 'px';
        img.style.top = Math.max(52, pr.top - 50) + 'px';
        img.classList.remove('d-none');
        clearTimeout(petMemeT);
        petMemeT = setTimeout(function() { img.classList.add('d-none'); }, 3500);
        petBeep('pop');
    }
    // ===== 导航帮手:推荐站点 / 天气 / 问候(桌宠与导航模块联动,用户点名功能) =====
    function petOpenUrl(url) {
        window.open(url, '_blank', 'noopener');
        if (typeof navTouchRecent === 'function') navTouchRecent(url);   // 计入最近使用
        petScoreAdd(2);   // 通过宠物打开站点:积分
    }
    // 推荐:最近常打开的站(可一键重开)+ 随机一个没逛过的站(纯 DOM 构建,防注入)
    function petSuggest(greetPrefix) {
        const pet = document.getElementById('navPet');
        const b = pet && pet.querySelector('.nav-pet-bubble');
        if (!b) return;
        const recents = navLsGet('navRecent').filter(function(x) { return x && x.url; });
        const all = [];
        document.querySelectorAll('.nav-hub [data-site-item][data-url]').forEach(function(el) {
            all.push({ url: String(el.getAttribute('data-url')), name: String(el.getAttribute('data-name') || '') });
        });
        if (!all.length) { petSay('页面上没有站点卡片可推荐', 2500); return; }
        const starred = navLsGet('navStars').filter(Boolean);
        const seen = new Set(recents.map(function(x) { return x.url; }).concat(starred));
        const freshPool = all.filter(function(x) { return !seen.has(x.url); });
        const fresh = freshPool.length ? freshPool[Math.floor(Math.random() * freshPool.length)] : all[Math.floor(Math.random() * all.length)];
        const freq = recents.slice().sort(function(a, c) { return (c.n || 0) - (a.n || 0); })[0];
        const freqInfo = freq ? (navCardInfo(freq.url) || freq) : null;
        b.textContent = '';
        b.classList.remove('d-none');
        b.classList.add('nav-pet-bubble-card');
        const mkLabel = function(t) {
            const d = document.createElement('div');
            d.style.margin = '0 0 .25rem';
            d.textContent = t;
            return d;
        };
        const mkBtn = function(label) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-outline-secondary btn-sm me-1 py-0 px-1';
            btn.style.fontSize = '.68rem';
            btn.textContent = label;
            return btn;
        };
        if (greetPrefix) b.appendChild(mkLabel('👋 ' + greetPrefix));
        if (freqInfo) {
            const row1 = document.createElement('div');
            row1.appendChild(mkLabel('💡 你常打开:' + freqInfo.name + (freq.n > 1 ? '(去过 ' + freq.n + ' 次)' : '')));
            const open1 = mkBtn('🚀 帮我打开');
            open1.addEventListener('click', function() { petOpenUrl(freqInfo.url); petSay('这就帮你打开~', 1500); });
            row1.appendChild(open1);
            b.appendChild(row1);
        }
        const row2 = document.createElement('div');
        row2.appendChild(mkLabel('🎁 试试没逛过的:' + fresh.name));
        const open2 = mkBtn('🚀 去看看');
        open2.addEventListener('click', function() { petOpenUrl(fresh.url); petSay('新的世界~', 1500); });
        row2.appendChild(open2);
        b.appendChild(row2);
        // 冷落星标:星标里最久没打开的一个(navRecent 里 ts 最小/从未打开优先)
        const recMap = {};
        recents.forEach(function(x) { recMap[x.url] = x.ts || 0; });
        let cold = null, coldTs = Infinity;
        starred.forEach(function(url) {
            const ts = (typeof recMap[url] === 'number') ? recMap[url] : -1;
            if (ts < coldTs) { coldTs = ts; cold = url; }
        });
        if (cold) {
            const cInfo = navCardInfo(cold) || { name: cold, url: cold };
            const row3 = document.createElement('div');
            row3.appendChild(mkLabel('🕰 星标里的 ' + cInfo.name + ' 好久没开了'));
            const open3 = mkBtn('🚀 再看看');
            open3.addEventListener('click', function() { petOpenUrl(cInfo.url); petSay('这就翻出来~', 1500); });
            row3.appendChild(open3);
            b.appendChild(row3);
        }
        clearTimeout(petBubbleT);
        petBubbleT = setTimeout(function() {
            b.classList.add('d-none');
            b.classList.remove('nav-pet-bubble-card');
        }, 10000);
        petBeep('ding');
    }
    // 天气:Open-Meteo(免 key),城市可配,缓存 30 分钟
    const PET_WX_TEXT = { 0: '晴', 1: '基本晴', 2: '局部多云', 3: '阴', 45: '雾', 48: '雾凇', 51: '毛毛雨', 53: '毛毛雨', 55: '浓毛毛雨', 56: '冻毛毛雨', 57: '浓冻毛毛雨', 61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '冻雨', 71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒', 80: '阵雨', 81: '阵雨', 82: '强阵雨', 85: '阵雪', 86: '阵雪', 95: '雷暴', 96: '雷暴冰雹', 99: '雷暴冰雹' };
    // 天气:城市解析走本服务端代理(api_nav_pet_geo)——open-meteo 中文搜索对区县/重名城市很弱
    // (实测「朝阳」首位是重庆一个 1.3 万人的乡,辽宁朝阳市不在结果里),服务器端打分消歧 + Nominatim 回落;
    // 实况走 api_nav_pet_weather(2026-11-18):中国气象局优先、Open-Meteo 兜底,服务端取数 + 10 分钟缓存
    function petFetchJson(url, ms) {
        const ctrl = new AbortController();
        const timer = setTimeout(function() { ctrl.abort(); }, ms || 8000);
        return fetch(url, { signal: ctrl.signal })
            .then(function(r) { return r.json(); })
            .finally(function() { clearTimeout(timer); });
    }
    function petWindBeaufort(kmh) {   // km/h → 蒲福风级(国人习惯"几级风")
        const caps = [1, 5, 11, 19, 28, 38, 49, 61, 74, 88, 102, 117];
        for (let i = 0; i < caps.length; i++) { if (kmh < caps[i]) return i; }
        return 12;
    }
    // 定位校验(2026-11-20 P0):增强天气链路里的经纬度来源——本机旧值 / 省市列表 /
    // pet-geo 地名解析 / 出口 IP 定位。以前每处各自 parseFloat,NaN、越界、(0,0) 都能
    // 混进去,结果要么请求打空、要么把大西洋当城市。统一在这里收口。
    function petGeoNum(v) {
        const n = typeof v === 'number' ? v : parseFloat(v);
        return isFinite(n) ? n : NaN;
    }
    function petGeoValid(p) {
        if (!p) return false;
        const lat = petGeoNum(p.lat), lon = petGeoNum(p.lon);
        if (!isFinite(lat) || !isFinite(lon)) return false;
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
        if (Math.abs(lat) < 1e-6 && Math.abs(lon) < 1e-6) return false;   // (0,0) 是大西洋,不是城市
        if (p.name != null && String(p.name).length > 60) return false;
        return true;
    }
    function petGeoSave(name, lat, lon, src) {
        try {
            localStorage.setItem('navPetCity', String(name || '').slice(0, 50));
            localStorage.setItem('navPetCityLat', String(lat));
            localStorage.setItem('navPetCityLon', String(lon));
            localStorage.setItem('navPetCitySrc', src || '');
            localStorage.setItem('navPetGeoAt', String(Date.now()));
        } catch (e) { /* 存不了只影响下次刷新,本次照常 */ }
    }
    // 读本机已存坐标;坏值直接清掉,让后面的兜底接手(否则每次问天气都拿 NaN 打一次空请求)
    function petGeoSaved() {
        let lat, lon, city = '';
        try {
            lat = petGeoNum(localStorage.getItem('navPetCityLat'));
            lon = petGeoNum(localStorage.getItem('navPetCityLon'));
            city = String(localStorage.getItem('navPetCity') || '').trim();
        } catch (e) { return null; }
        if (!petGeoValid({lat: lat, lon: lon, name: city})) {
            if (isFinite(lat) || isFinite(lon)) {
                try {
                    localStorage.removeItem('navPetCityLat');
                    localStorage.removeItem('navPetCityLon');
                    localStorage.removeItem('navPetCitySrc');
                } catch (e) {}
            }
            return null;
        }
        return {lat: lat, lon: lon, name: city};
    }
    // 没选过城市时的出口 IP 定位兜底:结果同样落本机,下次直接命中,不再打网络。
    function petLocateByIp() {
        if (!PET_AI_URLS.ipGeo) return Promise.reject(new Error('no ip geo url'));
        return petFetchJson(PET_AI_URLS.ipGeo, 8000).then(function (res) {
            const p = res && res.place;
            if (!res || res.status !== 'ok' || !petGeoValid(p)) throw new Error('ip geo invalid');
            const name = String(p.name || p.region || '').trim() || '本地';
            petGeoSave(name, p.lat, p.lon, 'ip');
            return {lat: p.lat, lon: p.lon, name: name, region: p.region || '', source: p.source || 'ip'};
        });
    }
    function petWeatherShow(place, temp, feels, text, windKmh, obs, geo, stale) {
        let line = '🌤 ' + place + ' ' + text + ' ' + temp + '°C';
        if (typeof feels === 'number' && !isNaN(feels) && feels !== temp) line += '(体感 ' + feels + '°)';
        if (typeof windKmh === 'number' && !isNaN(windKmh)) line += ' · ' + petWindBeaufort(windKmh) + ' 级风';
        if (obs) line += ' · ' + obs + ' 观测';   // 当地观测时间:旧缓存没有就不显示
        if (stale) line += ' · 非实时(缓存)';      // 服务抽风时顶上的旧数据,必须让用户看出来
        petSay(line, 5200);
        petBeep('ding');
        let anim = null;   // 天气换装:按天气/气温挑现成动画(热不热看体感)
        if (text.indexOf('雪') >= 0) anim = '堆雪人';
        else if (text.indexOf('雷') >= 0 || text.indexOf('冰雹') >= 0) anim = '被吓一跳';
        else if (text.indexOf('雾') >= 0) anim = '萌化小幽灵';
        else if (Math.max(temp, isNaN(feels) ? temp : feels) >= 33) anim = '吃冰淇淋融化';
        if (anim) setTimeout(function() {
            if (!document.getElementById('navPet')) return;
            petPlayByName(anim);
            petSay('这种天气,我就这么待着~', 2400);
        }, 5200);
        petWeatherBrief(geo, line);   // 空气 + 明日:拼到同一条气泡里,不覆盖主天气
    }
    // 空气质量 + 明日预报(2026-11-10 P1/P2):后端一次给两段,取不到就静默 —— 主气泡已经显示了
    function petWeatherBrief(geo, baseLine) {
        const saved = petGeoSaved();
        const p = petGeoValid(geo) ? geo : saved;
        if (!p) return;   // 还没定位到城市:跳过,不报错
        const lat = petGeoNum(p.lat), lon = petGeoNum(p.lon);
        petFetchJson(PET_AI_URLS.brief + '?lat=' + lat + '&lon=' + lon)
            .then(function(b) {
                if (!b || b.status !== 'ok') return;
                const parts = [];
                if (b.aqi && typeof b.aqi.value === 'number') {
                    parts.push('空气 ' + b.aqi.label + '(' + b.aqi.value + ')');
                }
                if (b.tomorrow) {
                    const t = b.tomorrow;
                    const w = t.text ? t.text + ' ' : (PET_WX_TEXT[t.code] ? PET_WX_TEXT[t.code] + ' ' : '');
                    parts.push('明天 ' + w + t.tmin + '~' + t.tmax + '°' +
                        (t.rain ? ' 降水' + t.rain + '%' : ''));
                }
                if (parts.length) {
                    // 拼在同一条气泡里:以前用高优先级 petSay 直接顶掉主天气,用户只看得到空气,
                    // 天气那行停留不到一秒(2026-11-20 实测发现,顺手补掉)
                    const head = baseLine ? baseLine + ' · ' : '';
                    petSay(head + '📊 ' + parts.join(' · '), 6400, PET_BUBBLE_PRIO.work);
                }
            })
            .catch(function() { /* 附加信息缺了不影响天气主气泡 */ });
    }
    // 每日英语:服务端接口(金山词霸 dsapi)优先;接口挂掉/被拦时回落本机静态语料,
    // 按一年中的第几天轮换,访客态也能看到句子。
    const PET_DAILY_EN_LOCAL = [
        { en: 'The best time to plant a tree was ten years ago. The second best time is now.', zh: '种一棵树最好的时间是十年前，其次是现在。' },
        { en: 'Small steps every day add up to big results.', zh: '每天一小步，日积月累就是大进步。' },
        { en: 'Curiosity is the engine of learning.', zh: '好奇心是学习的发动机。' },
        { en: 'A smooth sea never made a skilled sailor.', zh: '风平浪静的海面练不出熟练的水手。' },
        { en: 'Read a little every day, and you will know more than most people.', zh: '每天读一点，懂得就会超过多数人。' },
        { en: 'Do one thing at a time, and do it well.', zh: '一次做好一件事，把它做到位。' },
        { en: 'The limits of my language mean the limits of my world.', zh: '语言的边界，就是我世界的边界。' },
        { en: 'Practice does not make perfect; practice makes progress.', zh: '练习不求完美，但求日日有进。' },
        { en: 'Where there is a will, there is a way.', zh: '有志者，事竟成。' },
        { en: 'Keep a notebook: ideas you forget are ideas you lose.', zh: '随身记笔记：忘掉的点子，等于丢掉的点子。' },
        { en: 'Listen more than you speak; you will learn twice as much.', zh: '多听少说，学到的东西会多出一倍。' },
        { en: 'A good question is half the answer.', zh: '一个好问题，已经是答案的一半。' },
        { en: 'Today’s effort is tomorrow’s ease.', zh: '今天下的功夫，是明天的从容。' },
        { en: 'Be patient with yourself; growth takes time.', zh: '对自己有点耐心，成长本来就需要时间。' }
    ];
    function petDailyEnLocal() {
        var now = new Date();
        var day = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
        return PET_DAILY_EN_LOCAL[day % PET_DAILY_EN_LOCAL.length];
    }
    function petDailyEnFallback() {
        var s = petDailyEnLocal();
        petSay('📖 ' + s.en, 7000, PET_BUBBLE_PRIO.work);
        if (s.zh) setTimeout(function () { petSay(s.zh, 7000, PET_BUBBLE_PRIO.work); }, 7200);
    }
    function petDailyEn() {
        petSay('让我翻翻今天的句子…', 1600);
        petFetchJson(PET_AI_URLS.dailyEn)
            .then(function(d) {
                if (!d || d.status !== 'ok') { petDailyEnFallback(); return; }
                petSay('📖 ' + d.en, 7000, PET_BUBBLE_PRIO.work);
                if (d.zh) setTimeout(function() { petSay(d.zh, 7000, PET_BUBBLE_PRIO.work); }, 7200);
            })
            .catch(function() { petDailyEnFallback(); });
    }
    // 天气实况(2026-11-18 改):走本服务端代理,前端不再直连 api.open-meteo.com。
    // 依据:国内实测 open-meteo 首包 8.38s 直接超时(第二次才 1.81s),失败时桌宠只能干说
    // 「天气服务打不开」;同一时刻中国气象局 /api/now 0.18s。服务端因此改为
    // 中国气象局优先、Open-Meteo 兜底,并缓存 10 分钟(见 nav/pet_weather.py)。
    function petWeatherCacheRead(key) {
        try {
            const c = JSON.parse(sessionStorage.getItem('navPetWxCache') || 'null');
            return (c && c.city === key) ? c : null;
        } catch (e) { return null; }
    }
    // 缓存键:有坐标就按坐标(0.01° 精度),没坐标按城市名 —— IP 定位和手动选城不会互相串
    function petWxKey(p) {
        if (petGeoValid(p)) return petGeoNum(p.lat).toFixed(2) + ',' + petGeoNum(p.lon).toFixed(2);
        return String((p && p.name) || localStorage.getItem('navPetCity') || '广州').trim() || '广州';
    }
    function petWeatherFromServer(city, lat, lon, placeLabel, geo, cacheKey) {
        if (!petGeoValid({lat: lat, lon: lon})) return Promise.reject(new Error('bad coords'));
        const q = '?lat=' + petGeoNum(lat) + '&lon=' + petGeoNum(lon) + '&name=' + encodeURIComponent(city || '');
        return petFetchJson(PET_AI_URLS.weather + q, 16000)
            .then(function(res) {
                const wx = res && res.weather;
                if (!res || res.status !== 'ok' || !wx) throw new Error('no weather');
                const rawTemp = petGeoNum(wx.temp);
                if (!isFinite(rawTemp) || rawTemp < -60 || rawTemp > 60) throw new Error('bad temp');
                const text = wx.text || PET_WX_TEXT[wx.code] || '未知天象';
                const place = placeLabel || wx.place || city || '当前位置';
                const temp = Math.round(rawTemp);
                const feels = (typeof wx.feels === 'number') ? Math.round(wx.feels) : NaN;
                const windKmh = (typeof wx.windKmh === 'number') ? Math.round(wx.windKmh) : NaN;
                const obs = String(wx.obs || '');
                try { sessionStorage.setItem('navPetWxCache', JSON.stringify(
                    { t: Date.now(), city: cacheKey || city || '', place: place, temp: temp, feels: feels,
                      text: text, windKmh: windKmh, obs: obs })); } catch (e) { /* 存不了就算了 */ }
                petWeatherShow(place, temp, feels, text, windKmh, obs, { lat: petGeoNum(lat), lon: petGeoNum(lon) });
            });
    }
    // 地名解析链路(省市列表之外的手输城市):解析结果与输入去后缀一致就按输入显示;
    // 不一致(重名消歧)展示「输入→解析到哪」,一眼看出对不对。
    function petWeatherByCity(city) {
        return petFetchJson(PET_AI_URLS.petGeo + '?name=' + encodeURIComponent(city))
            .then(function(g) {
                if (!g || g.status !== 'ok' || !petGeoValid(g.place)) {
                    const msg = (g && g.message) || ('没找到「' + city + '」');
                    petSay(msg, 3200);
                    throw { geoFail: true };   // 已经说过原因,别再被上层盖成「天气服务打不开」
                }
                const p = g.place;
                const stripTail = function(s) { return String(s).replace(/(市|县|区|旗)$/, ''); };
                const place = stripTail(p.name) === stripTail(city)
                    ? stripTail(city)
                    : city + '→' + p.name + (p.region ? '·' + p.region : '');
                // 解析结果存本机:下次直接按坐标取天气,不再打一次 Nominatim(1 req/s 的配额省着用)
                petGeoSave(city, p.lat, p.lon, 'geo');
                return petWeatherFromServer(city, p.lat, p.lon, place,
                                            { lat: p.lat, lon: p.lon }, city);
            });
    }
    function petWeather() {
        const saved = petGeoSaved();
        const ckey = petWxKey(saved || {});
        const cache = petWeatherCacheRead(ckey);
        if (cache && Date.now() - cache.t < 30 * 60000) {
            petWeatherShow(cache.place, cache.temp, cache.feels, cache.text, cache.windKmh, cache.obs);
            return;
        }
        // 服务抽风时的统一出口:12 小时内的旧数据先顶上并标「非实时」,没有才报打不开
        const fail = function() {
            if (cache && Date.now() - cache.t < 12 * 3600000) {
                petWeatherShow(cache.place, cache.temp, cache.feels, cache.text,
                               cache.windKmh, cache.obs, null, true);
                return;
            }
            petSay('天气服务打不开(需要联网),稍后再试吧', 3000);
        };
        if (saved) {   // 中国城市列表选的 / 上次定位留下的:经纬度直接用,不查地名
            petWeatherFromServer(saved.name, saved.lat, saved.lon, null,
                                 { lat: saved.lat, lon: saved.lon }, ckey).catch(fail);
            return;
        }
        // 没存过(或旧值非法已清掉):先按出口 IP 定位 —— 这是「没选城市就写死广州」的补丁
        petSay('我先看看你在哪…', 1600);
        petLocateByIp()
            .then(function(geo) {
                return petWeatherFromServer(geo.name, geo.lat, geo.lon, null,
                                            { lat: geo.lat, lon: geo.lon }, petWxKey(geo));
            })
            .catch(function() {
                const city = (localStorage.getItem('navPetCity') || '广州').trim() || '广州';
                return petWeatherByCity(city);
            })
            .catch(function(err) {
                if (err && err.geoFail) return;   // 地名解析已给过提示
                fail();
            });
    }
    // ===== 页面状态联动:离开/回归 + 闲置自动打盹 + 拖卡片到宠物=一键星标 =====
    let petHideAt = null, petLastActive = Date.now();
    ['mousemove', 'click', 'keydown', 'scroll', 'touchstart'].forEach(function(t) {
        document.addEventListener(t, function(ev) {
            petLastActive = Date.now();
            const p = document.getElementById('navPet');
            if (!p || !p.dataset.sleeping) return;
            // 手动打盹只有"点它"才醒(动鼠标不算);自动打盹动一下就醒
            if (p.dataset.manualSleep === '1' && t !== 'click') return;
            // 点在宠物身上:交给它自己的 click 处理(会播「起来」三段收尾),这里不能抢先把标记擦掉
            if (t === 'click' && ev && ev.target && ev.target.closest && ev.target.closest('#navPet')) return;
            delete p.dataset.sleeping;
            delete p.dataset.sleepPhase;
            // 唤醒要真醒:只删标记的话视频还锁在睡觉循环里,要等下一分钟心跳才恢复
            if (p._petPlay) p._petPlay('idle');
        }, { passive: true, capture: true });
    });
    document.addEventListener('visibilitychange', function() {
        if (localStorage.getItem('navPetOn') === '0') return;
        if (document.hidden) { petHideAt = Date.now(); return; }
        const away = petHideAt ? Date.now() - petHideAt : 0;
        petHideAt = null;
        if (away > 60000 && document.getElementById('navPet')) {
            petSay('回来啦!我等了 ' + Math.min(99, Math.round(away / 60000)) + ' 分钟~', 2800);
            window.navPetState('happy');
        }
    });
    // 拖拽站点卡片到宠物 = 一键星标(与拖到目录换分类共用 $dragSrc 体系;委托到 document,桌宠关着不干扰)
    let petDragHover = false;
    document.addEventListener('dragover', function(e) {
        if (!window.navDragSrcEl || !e.target.closest || !e.target.closest('#navPet')) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        if (!petDragHover) { petDragHover = true; petSay('松手我就帮你星标!', 1800); }
    });
    document.addEventListener('dragleave', function(e) {
        if (e.target.closest && e.target.closest('#navPet')) petDragHover = false;
    });
    document.addEventListener('drop', function(e) {
        if (!petDragHover) { if (e.target.closest && e.target.closest('#navPet')) petDragHover = false; return; }
        e.preventDefault(); e.stopPropagation();
        petDragHover = false;
        const $src = $(window.navDragSrcEl);
        const name = String($src.attr('data-name') || '新站点');
        const url = String($src.attr('data-url') || '');
        const stars = new Set(navLsGet('navStars'));
        if (stars.has(url)) {
            petSay('它早就在星标里啦~', 2000);
        } else {
            stars.add(url);
            navLsSet('navStars', Array.from(stars));
            if (typeof renderNavStars === 'function') renderNavStars();
            window.navPetState('happy');
            petSay('我帮你星标了 ' + name + '!', 2400);
            petBeep('ding');
            petScoreAdd(3);
        }
        // 不在此处清拖拽句柄:置空会让随后的 dragend 开头 early-return,
        // .drag-src(半透明)永远留在卡上;改走 navDragMarkMoved 让 dragend 照常清理
        if (window.navDragMarkMoved) window.navDragMarkMoved();
        $('#navToc').removeClass('drag-armed');
    }, true);
    // 闲置(默认 5 分钟,可被 navPetIdleSleepMs 覆盖)自动打盹:任何活动或点它即醒
    function petIdleSleepMs() { return parseInt(localStorage.getItem('navPetIdleSleepMs'), 10) || 300000; }
    // 问候语:按时间段请安
    function petGreetText() {
        const h = new Date().getHours();
        if (h >= 5 && h < 8) return '起这么早,喝口水慢慢逛';
        if (h >= 8 && h < 11) return '早上好!今天想逛点啥';
        if (h >= 11 && h < 13) return '中午好,吃饱了再逛';
        if (h >= 13 && h < 18) return '下午好,提神继续冲';
        if (h >= 18 && h < 23) return '晚上好,夜逛模式开启';
        return '夜深了,逛完早点休息';
    }
    // ===== 养成层:心情/精力/无聊(参考同类桌宠:时间衰减,互动回血) =====
    // 本地日期串(YYYY-MM-DD):toISOString 取的是 UTC 日期,东八区 0~8 点算"昨天",
    // 签到/每日一签/节日/家底速报会整体偏移 8 小时(2026-10-06 修复)
    function navLocalDateStr(d) {
        d = d || new Date();
        return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    }
    function petVitals() {
        let v = null;
        try { v = JSON.parse(localStorage.getItem('navPetVitals') || 'null'); } catch (e) { v = null; }
        if (!v || typeof v.mood !== 'number') v = { mood: 80, energy: 80, bored: 20, t: Date.now() };
        const mins = Math.min(720, Math.max(0, (Date.now() - (v.t || Date.now())) / 60000));
        const cl = function(x) { return Math.max(0, Math.min(100, x)); };
        v.bored = cl(v.bored + mins * 0.5);    // 挂着不动会无聊
        v.energy = cl(v.energy - mins * 0.2);  // 精力缓慢消耗
        v.mood = cl(v.mood - mins * 0.1);
        v.t = Date.now();
        return v;
    }
    function petVitalsSave(v) { v.t = Date.now(); localStorage.setItem('navPetVitals', JSON.stringify(v)); }
    function petBar(p) { const f = Math.round(Math.max(0, Math.min(100, p)) / 20); return '▰'.repeat(f) + '▱'.repeat(5 - f); }
    // ===== 签到与等级:互动攒积分,每 50 分升一级,升级庆祝 =====
    function petSignData() {
        let s = null;
        try { s = JSON.parse(localStorage.getItem('navPetSign') || 'null'); } catch (e) { s = null; }
        const today = navLocalDateStr();
        if (!s || typeof s.score !== 'number') s = { last: '', days: 0, score: 0 };
        if (s.last !== today) {
            const yest = navLocalDateStr(new Date(Date.now() - 86400000));
            s.days = (s.last === yest ? (s.days || 0) + 1 : 1);   // 断签归零重计
            s.last = today;
            s.score += 5;   // 每日签到 +5
            try { localStorage.setItem('navPetSign', JSON.stringify(s)); } catch (e) {}
            s.justSigned = true;
        }
        return s;
    }
    function petLevelOf(score) { return Math.floor(score / 50) + 1; }
    function petScoreAdd(delta) {
        const s = petSignData();
        const oldLv = petLevelOf(s.score);
        s.score += delta;
        try { localStorage.setItem('navPetSign', JSON.stringify(s)); } catch (e) {}
        const newLv = petLevelOf(s.score);
        if (newLv > oldLv && document.getElementById('navPet')) {
            const oldTier = PET_TIERS.reduce(function(acc, t, i) { return oldLv >= t.minLv ? i : acc; }, 0);
            const newTier = petTierIdx();
            if (newTier > oldTier) {
                // 跨形态:进化仪式(换装试色 + 播报新形态与解锁内容)
                petPlayByName('整体换装试色');
                const unlocked = PET_TIERS[newTier].pools.filter(function(k) { return PET_TIERS[oldTier].pools.indexOf(k) === -1; });
                const poolNames = {idle: '待机', play: '玩耍', eat: '吃饭', show: '表演', festival: '节日'};
                const unlockText = unlocked.length ? ',解锁了「' + unlocked.map(function(k) { return poolNames[k] || k; }).join('」「') + '」闲置动作' : '';
                petSay('✨ 进化!我现在是「' + PET_TIERS[newTier].name + '」啦(Lv.' + newLv + ')' + unlockText, 5200);
                petBeep('ding');
            } else {
                window.navPetState('happy');
                petSay('🎉 升级!我现在是 Lv.' + newLv + ' 啦!', 3200);
                petBeep('ding');
            }
        }
    }
    // ===== 每日一签:每天第一次点宠物抽运势(宜/忌带导航味,附彩蛋动画) =====
    const PET_FORTUNES = [
        ['宜早睡早起,忌熬夜刷屏', '原地小憩沉眠'],
        ['宜出门走走,忌久坐不动', '原地左转奔跑'],
        ['宜多喝热水,忌贪杯冰饮', '吃冰淇淋融化'],
        ['宜整理心情,忌钻牛角尖', '哈欠连天'],
        ['宜当面沟通,忌胡乱猜疑', '东张西望'],
        ['宜把事做完,忌半途而废', '工作状态-清点归档'],
        ['宜虚心请教,忌不懂装懂', '工作状态-思考冒泡'],
        ['宜运动出汗,忌躺平一天', '踢毽子'],
        ['宜读几页书,忌刷短视频', '悠闲哼歌'],
        ['宜早做计划,忌临阵磨枪', '工作状态-原地踱步张望'],
        ['宜奖励自己一顿好的,忌将就', '涮火锅'],
        ['宜给家人打电话,忌忙到忘记', '放烟花'],
        ['宜晒晒太阳,忌闷在屋里', '蝴蝶蜜蜂环绕头顶开花'],
        ['宜穿得舒服,忌将就形象', '照镜子'],
        ['宜动手做点小事,忌只想不做', '原地专心玩魔方'],
        ['宜早点收工,忌无限加班', '超大伸懒腰'],
        ['宜开窗透气,忌空气不流通', '鲸鱼吐泡泡特效'],
        ['宜保持微笑,忌皱眉头', '点击回应-开心跃动'],
        ['宜准时吃饭,忌忙到跳过', '吃早餐'],
        ['宜少说多做,忌夸夸其谈', '撸猫']
    ];
    function petFortuneOfDay() {
        const today = navLocalDateStr();
        let f = null;
        try { f = JSON.parse(localStorage.getItem('navPetFortune') || 'null'); } catch (e) { f = null; }
        if (f && f.date === today) return f;
        const pick = PET_FORTUNES[Math.floor(Math.random() * PET_FORTUNES.length)];
        f = { date: today, text: pick[0], anim: pick[1], fresh: true };
        try { localStorage.setItem('navPetFortune', JSON.stringify(f)); } catch (e) {}
        return f;
    }
    // 喂食:随机吃饭动画 + 精力/心情回升
    function petFeed() {
        const v = petVitals();
        v.energy = Math.min(100, v.energy + 20); v.mood = Math.min(100, v.mood + 10); v.bored = Math.max(0, v.bored - 5);
        petVitalsSave(v);
        petScoreAdd(5);
        // 上游「吃白饭」玩法:跑来 → 急躁 → 期待 → 端碗吃 → 吃饭团,5 段顺序演出
        petPlaySeq(PET_BAIFAN, function() { petSay('啊呜~ 吃饱啦!', 2200); });
        petSay('开饭啦~', 1600);
        petBeep('pop');
    }
    // 状态:三围条形图卡片
    function petStatus() {
        const pet = document.getElementById('navPet');
        const b = pet && pet.querySelector('.nav-pet-bubble');
        if (!b) return;
        const v = petVitals();
        b.textContent = '';
        b.classList.remove('d-none');
        b.classList.add('nav-pet-bubble-card');
        [['心情', v.mood], ['精力', v.energy], ['无聊', v.bored]].forEach(function(pair) {
            const d = document.createElement('div');
            d.textContent = pair[0] + ' ' + petBar(pair[1]) + ' ' + Math.round(pair[1]);
            b.appendChild(d);
        });
        const sign = petSignData();
        const lv = document.createElement('div');
        lv.textContent = '⭐ Lv.' + petLevelOf(sign.score) + ' ' + petTier().name + ' · 积分 ' + sign.score + ' · 连签 ' + sign.days + ' 天';
        b.appendChild(lv);
        const tip = document.createElement('div');
        tip.style.fontSize = '.78em';   // 相对气泡字号,跟着界面缩放走
        tip.style.opacity = '.7';
        tip.textContent = '点我逗乐,喂食回血,挂着不动会无聊';
        b.appendChild(tip);
        clearTimeout(petBubbleT);
        petBubbleT = setTimeout(function() { b.classList.add('d-none'); b.classList.remove('nav-pet-bubble-card'); }, 6000);
        petBeep('ding');
    }
    // 节日祝福(公历节日 + 对应动画)
    const PET_FESTIVALS = {
        '01-01': ['元旦快乐!新的一年一起冲', '放烟花'],
        '02-14': ['情人节,鲸鱼也要甜甜的', '可爱宅舞'],
        '03-08': ['妇女节快乐!', '优雅女仆舞'],
        '03-12': ['植树节,种棵树吧', '凭空生花'],
        '04-01': ['愚人节,我今天说的话别全信哦', '变鸽子'],
        '05-01': ['劳动节快乐!放下活儿逛一逛', '工作状态-忙碌点按'],
        '06-01': ['儿童节快乐!永葆童心', '骑木马'],
        '09-10': ['教师节快乐!', '女仆屈膝礼仪'],
        '10-01': ['国庆快乐!放假逛起来', '放烟花'],
        '10-24': ['程序员节(1024),代码无 bug!', '写代码'],
        '10-31': ['万圣夜,要不要扮个小幽灵', '讨糖南瓜灯'],
        '12-22': ['冬至,记得吃饺子', '吃饺子'],
        '12-25': ['圣诞快乐!记得吃顿好的', '装点圣诞树']
    };
    // 农历节日:用 calendar-converter.js(lunarInfo 覆盖 1900-2100)实时换算,永不过期
    // 键 = 农历"月-日"(lMonth-lDay);除夕单独算(明天是正月初一就是今天)
    const PET_FESTIVALS_LUNAR = {
        '1-1': ['春节快乐!新年大吉', '收红包'],
        '1-15': ['元宵节,来碗汤圆', '吃汤圆'],
        '5-5': ['端午安康!', '吃粽子'],
        '7-7': ['七夕,今晚有鹊桥', '荡秋千'],
        '8-15': ['中秋快乐!赏月吃月饼', '中秋赏月吃月饼'],
        '9-9': ['重阳节,记得问候长辈', '插茱萸赏菊'],
        '12-8': ['腊八节,喝腊八粥啦', '吃腊八粥']
    };
    function petLunarFest(now) {
        if (!window.calendar || !calendar.solar2lunar) return null;   // 库没加载就不触发,公历节日照常
        const lu = calendar.solar2lunar(now.getFullYear(), now.getMonth() + 1, now.getDate());
        if (!lu || lu === -1) return null;
        if (PET_FESTIVALS_LUNAR[lu.lMonth + '-' + lu.lDay]) return PET_FESTIVALS_LUNAR[lu.lMonth + '-' + lu.lDay];
        const tm = new Date(now.getTime() + 86400000);
        const td = calendar.solar2lunar(tm.getFullYear(), tm.getMonth() + 1, tm.getDate());
        if (td && td !== -1 && td.lMonth === 1 && td.lDay === 1) return ['今晚除夕!明天春节,提前年个吉祥', '放烟花'];
        return null;
    }
    window.petLunarFest = petLunarFest;   // 调试/测试取用
    // 逢节分类标题挂灯笼(只挂一次)
    function petLanternApply() {
        document.querySelectorAll('.nav-hub .nav-cat-title').forEach(function(t) {
            if (!t.dataset.lantern) { t.dataset.lantern = '1'; t.insertAdjacentHTML('afterbegin', '🏮 '); }
        });
    }
    // 加载问候(有"欢迎新成员"标记则优先)+ 节日祝福 + 每日一次家底速报与主动推荐
    if (localStorage.getItem('navPetGreet') !== '0') {
        setTimeout(function() {
            if (!document.getElementById('navPet')) return;
            let welcome = null;
            try { welcome = sessionStorage.getItem('navPetWelcome'); } catch (e) { welcome = null; }
            if (welcome) {
                try { sessionStorage.removeItem('navPetWelcome'); } catch (e) {}
                window.navPetState('happy');
                petSay('欢迎新伙伴 ' + welcome + ' 入住导航!', 3400);
                return;
            }
            const sd = petSignData();
            if ([7, 30, 100, 365].indexOf(sd.days) >= 0) {   // 相识纪念日
                window.navPetState('happy');
                petSay('今天是我们认识第 ' + sd.days + ' 天,纪念日快乐!', 4000);
                return;
            }
            const wd = new Date().getDay();
            if (wd === 0 || wd === 6) {   // 周末变装:播一个表演池动画 + 周末问候
                petPlayByName(petPickAnim(PET_POOL.show));
                petSay(petGreetText() + ' 周末愉快!', 3400);
                return;
            }
            petSay(petGreetText(), 3200);
        }, 1100);
        setTimeout(function() {
            if (!document.getElementById('navPet')) return;
            const now = new Date();
            const key = ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2);
            const today2 = navLocalDateStr(now);
            const fest = PET_FESTIVALS[key] || petLunarFest(now);
            if (fest) petLanternApply();   // 是节日:分类标题挂灯笼(先挂,祝福一天一次)
            if (!fest) return;
            if (localStorage.getItem('navPetFestDay') === today2) return;
            localStorage.setItem('navPetFestDay', today2);
            petSay('🎉 ' + fest[0], 4000);
            petPlayByName(fest[1]);
            petBeep('greet');
        }, 4500);
        setTimeout(function() {
            const today = navLocalDateStr();
            if (!document.getElementById('navPet') || localStorage.getItem('navPetDayDone') === today) return;
            localStorage.setItem('navPetDayDone', today);
            const sites = document.querySelectorAll('.nav-hub [data-site-item]').length;
            const stars = navLsGet('navStars').filter(Boolean).length;
            const clicks = navLsGet('navRecent').reduce(function(a, x) { return a + (x.n || 0); }, 0);
            const sign = petSignData();
            petSay('📊 家底速报:' + sites + ' 个站点 · 星标 ' + stars + ' · 累计打开 ' + clicks + ' 次 · 连签 ' + sign.days + ' 天' + (sign.justSigned ? '(今日已签到)' : ''), 4200);
            if (navLsGet('navRecent').filter(Boolean).length) {   // 没有历史不主动推荐
                setTimeout(function() { petSuggest(petGreetText() + '~'); }, 4200);
            }
        }, 7000);
    }
    // 状态联动入口(蒸馏 dsh-pet 的会话状态演出):页面任务可通过
    // navPetState('work'|'happy'|'idle') 驱动宠物换装对应动画
    window.navPetState = function(state) {
        const pet = document.getElementById('navPet');
        if (!pet || !pet._petPlayName) return;
        delete pet.dataset.sleeping;      // 任务演出把打盹的也叫醒
        delete pet.dataset.manualSleep;
        if (state === 'work') pet._petPlay('work');
        else if (state === 'happy') pet._petPlay('happy');
        else if (state === 'fail') pet._petPlayName('工作状态-垂头叹气冒汗');   // 任务失败演出
        else pet._petPlay('idle');
    };
    window.navPetWork = function() {           // 兼容入口:等同 navPetState('work')
        window.navPetState('work');
    };
    // ===== 命令表情(蒸馏 dsh-pet command-faces)=====
    // 在 AI 输入框里打 /笑 这类指令,直接触发动作或表情,不发网络请求。
    const PET_COMMANDS = {
        '/笑': ['点击回应-挠痒咯咯笑', '嘿嘿~'],
        '/气': ['点击回应-傲娇生气', '哼!'],
        '/惊': ['被吓一跳', '吓我一跳!'],
        '/羞': ['点击回应-害羞惊讶', '哎呀…'],
        '/挥': ['点击回应-元气挥手', '嗨~'],
        '/舞': ['轻快摇摆舞', '看我的!'],
        '/懒': ['超大伸懒腰', '伸个懒腰~'],
        '/照镜': ['照镜子', '今天也很可爱'],
        '/睡': ['@sleep', '睡一会儿'],
        '/吃': ['@feed', '开饭!'],
        '/白饭': ['@baifan', '吃白饭!']
    };
    function petCommand(text) {
        const t = String(text || '').trim();
        if (t === '/help' || t === '/?' || t === '/指令') {
            petSay('指令:' + Object.keys(PET_COMMANDS).join(' ') + '(直接打字发送即可)', 7000, PET_BUBBLE_PRIO.work);
            return true;
        }
        const cmd = PET_COMMANDS[t];
        if (!cmd) return false;
        if (cmd[0] === '@sleep') petSleep(false);
        else if (cmd[0] === '@feed') petFeed();
        else if (cmd[0] === '@baifan') petBaifanStart();
        else { petPlayByName(cmd[0]); petSay(cmd[1], 1800, PET_BUBBLE_PRIO.balance); }
        petBeep('pop');
        return true;
    }
    window.petCommand = petCommand;
    window.petBubblePrio = PET_BUBBLE_PRIO;
    window.petSpeak = petSpeak;   // 通知/语音通道共用(nav-sites.js 的 petNotify 会调)
    window.navPetSay = petSay;
    window.petIdlePoolNames = petIdlePoolNames;   // 形态解锁的闲置池(调试/测试取用)                 // 导航任务完成时可冒一句(如测活结束)
    // 双击:报家底(委托到 document,开关重挂后依然有效)
    document.addEventListener('dblclick', function(e) {
        if (e.target.closest('#navPet')) {
            const pet = document.getElementById('navPet');
            if (pet && pet._aiOpenTimer) { clearTimeout(pet._aiOpenTimer); pet._aiOpenTimer = null; }
            petStats();
        }
    });
    // ===== 右键菜单(蒸馏 dsh-pet:动作点播/说话/回初始位/设置)——外观复用 .dropdown-menu 主题 =====
    const petMenu = document.createElement('div');
    petMenu.id = 'navPetMenu';
    petMenu.className = 'dropdown-menu';
    petMenu.style.display = 'none';
    const petMenuItem = (action, label, extra) =>
        '<div class="dropdown-item" data-pet-action="' + action + '"' + (extra ? ' ' + extra : '') + '>' + label + '</div>';
    // 2026-11-07 菜单收口:原来 24 项平铺、高度 800px+,超过一屏。现在顶层只留
    // 4 个高频动作 + 4 个分组子菜单;子菜单悬停/点击展开,右侧越界时向左翻。
    const petSub = (label, items) =>
        '<div class="pet-sub">' +
        '<div class="dropdown-item pet-sub-toggle">' + label + '</div>' +
        '<div class="pet-sub-list">' + items + '</div></div>';
    petMenu.innerHTML =
        petMenuItem('random', '🎲 随机来一个') +
        petMenuItem('actions', '🎬 动作点播…') +
        petMenuItem('feed', '🍚 喂食') +
        petMenuItem('status', '❤️ 状态') +
        '<div class="pet-menu-divider"></div>' +
        petSub('🎭 演出与声音',
            petMenuItem('meme', '🖼 来张表情包') +
            petMenuItem('noise-wave', '🌊 海浪声', 'id="navPetNoiseWave"') +
            petMenuItem('noise-rain', '🌧 雨声', 'id="navPetNoiseRain"') +
            petMenuItem('notifytest', '🔔 通知测试') +
            petMenuItem('cmdhelp', '⌨️ 指令列表')) +
        petSub('🧸 互动与聊天',
            petMenuItem('walk', '🚶 散步一会儿') +
            petMenuItem('baifan', '🍱 吃白饭(玩法)') +
            petMenuItem('sleep', '😴 打个盹') +
            petMenuItem('say', '💬 说一句') +
            petMenuItem('aichat', '💬 快捷问答…') +
            petMenuItem('chatwin', '💬 聊天窗口…') +
            (window.NAV_GUEST_MODE ? petMenuItem('localai', '🔑 自带 Key 对话') : '') +
            petMenuItem('fish', '🎣 钓鱼')) +
        petSub('🧭 导航帮手',
            petMenuItem('suggest', '💡 帮我推荐站点') +
            petMenuItem('openstar', '🎲 随机开个星标') +
            petMenuItem('blindbox', '🎁 开个盲盒') +
            petMenuItem('basket', '🧺 死链篮…', 'id="navPetBasketItem"') +
            petMenuItem('shop', '🛒 积分商店…') +
            petMenuItem('weather', '🌤 问问天气') +
            petMenuItem('dailyen', '📖 每日英语') +
            petMenuItem('balance', '💰 查看余额(AI)', 'id="navPetBalanceItem"') +
            petMenuItem('stats', '📊 报家底')) +
        petSub('⚙️ 设置',
            petMenuItem('home', '🏠 回初始位') +
            petMenuItem('settings', '⚙️ 宠物设置…') +
            petMenuItem('whisper', '🔕 碎碎念:开', 'id="navPetWhisperItem"') +
            petMenuItem('off', '👋 再见(隐藏桌宠)'));
    document.body.appendChild(petMenu);
    function petMenuShow(x, y) {
        petMenu.style.display = 'block';
        petMenu.style.left = '0px'; petMenu.style.top = '0px';   // 先归零再量尺寸,防屏幕边缘量出负溢出
        const r = petMenu.getBoundingClientRect();
        petMenu.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
        petMenu.style.top = Math.max(48, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
        const wi = document.getElementById('navPetWhisperItem');
        if (wi) wi.textContent = localStorage.getItem('navPetWhisper') === '0' ? '💬 碎碎念:已关' : '🔕 碎碎念:开';
        const bi = document.getElementById('navPetBalanceItem');
        if (bi) bi.style.display = (petAiReady === true) ? '' : 'none';   // 未接 AI 直接不显示(用户要求)
        const nw = document.getElementById('navPetNoiseWave'), nr = document.getElementById('navPetNoiseRain');
        if (nw) nw.textContent = petNoiseMenuLabel('wave');
        if (nr) nr.textContent = petNoiseMenuLabel('rain');
    }
    function petMenuHide() {
        petMenu.style.display = 'none';
        petMenu.querySelectorAll('.pet-sub.open').forEach(el => el.classList.remove('open'));
    }

    // 子菜单:悬停展开(桌面)、点击也能钉住(触控板/笔记本),右侧空间不够就向左翻
    function petSubOpen(sub) {
        petMenu.querySelectorAll('.pet-sub.open').forEach(el => { if (el !== sub) el.classList.remove('open'); });
        sub.classList.remove('flip');
        const list = sub.querySelector('.pet-sub-list');
        if (!list) return;
        // 每次展开先复位,避免上一次的位移/限高残留
        list.style.marginTop = '';
        list.style.maxHeight = '';
        list.style.overflowY = '';
        sub.classList.add('open');

        // 横向:右侧空间不够就向左翻
        let r = list.getBoundingClientRect();
        if (r.right > window.innerWidth - 8) {
            sub.classList.add('flip');
            r = list.getBoundingClientRect();
        }
        // 纵向:菜单贴着屏幕底部时(桌宠就住在右下角),子菜单会伸到视口外。
        // 先整体上移;上移到底还不够,再限高 + 内部滚动 —— 保证每一项都点得到。
        const overflow = r.bottom - (window.innerHeight - 8);
        if (overflow > 0) {
            const shift = Math.max(0, Math.min(overflow, r.top - 8));
            if (shift > 0) list.style.marginTop = -shift + 'px';
            const remaining = r.bottom - shift - (window.innerHeight - 8);
            if (remaining > 0) {
                list.style.maxHeight = Math.max(120, r.height - remaining) + 'px';
                list.style.overflowY = 'auto';
            }
        }
    }
    function petMenuShowRefreshNoise() {
        const nw = document.getElementById('navPetNoiseWave'), nr = document.getElementById('navPetNoiseRain');
        if (nw) nw.textContent = petNoiseMenuLabel('wave');
        if (nr) nr.textContent = petNoiseMenuLabel('rain');
    }
    function petPlayByName(name) {
        const pet = document.getElementById('navPet');
        if (pet && pet._petPlayName) {
            delete pet.dataset.sleeping;      // 任何点播都会叫醒
            delete pet.dataset.manualSleep;
            delete pet.dataset.sleepPhase;
            delete pet.dataset.seqPlaying;    // 手动点播打断多段演出
            petSeq = null;
            pet._petPlayName(name);
        }
    }
    // 顺序播放:names 依序播完一段接一段(onDone 在最后一段播完时回调)
    function petPlaySeq(names, onDone) {
        const pet = document.getElementById('navPet');
        if (!pet || !pet._petPlayName || !names || !names.length) return;
        delete pet.dataset.sleeping;
        delete pet.dataset.manualSleep;
        delete pet.dataset.sleepPhase;
        petSeq = { names: names.slice(), onDone: onDone || null };
        pet.dataset.seqPlaying = '1';
        pet._petPlayName(petSeq.names.shift());
    }
    function petMenuRun(action) {
        if (action === 'random') {
            petPlayByName(PET_FUN[Math.floor(Math.random() * PET_FUN.length)]);
        } else if (action === 'actions') {
            bootstrap.Modal.getOrCreateInstance(petActModal).show();
        } else if (action === 'settings') {
            petSettingsSync();
            petSetTabRestore();   // 回到上次看的页签(2026-11-18)
            bootstrap.Modal.getOrCreateInstance(petSetModal).show();
        } else if (action === 'walk') {
            petWalk();
        } else if (action === 'sleep') {
            petSleep();
        } else if (action === 'feed') {
            petFeed();
        } else if (action === 'baifan') {
            petBaifanStart();
        } else if (action === 'status') {
            petStatus();
        } else if (action === 'meme') {
            petMeme();
        } else if (action === 'suggest') {
            petSuggest();
        } else if (action === 'openstar') {
            const stars = navLsGet('navStars').filter(Boolean);
            if (!stars.length) { petSay('星标还是空的,拖张卡片给我就行~', 2400); return; }
            const url = stars[Math.floor(Math.random() * stars.length)];
            const info = navCardInfo(url) || { name: url, url: url };
            petOpenUrl(info.url);
            window.navPetState('happy');
            petSay('翻开星标:「' + info.name + '」!', 2200);
        } else if (action === 'blindbox') {
            const cards = [...document.querySelectorAll('.nav-hub [data-site-item][data-url]')];
            const recentUrls = {};
            navLsGet('navRecent').slice(0, 5).forEach(function(x) { recentUrls[x.url] = 1; });
            const pool = cards.filter(function(c) { return !recentUrls[String(c.getAttribute('data-url'))]; });
            const src2 = pool.length ? pool : cards;
            const pick = src2[Math.floor(Math.random() * src2.length)];
            const bname = String(pick.getAttribute('data-name') || '神秘站点');
            petOpenUrl(String(pick.getAttribute('data-url')));
            window.navPetState('happy');
            petSay('🎁 盲盒开出:「' + bname + '」!', 2400);
        } else if (action === 'basket') {
            if (window.NAV_GUEST_MODE && window.navGuestBasket) window.navGuestBasket.open();
            else if (window.navBasketOpen) window.navBasketOpen('basket');
        } else if (action === 'shop') {
            petShopOpen();
        } else if (action === 'noise-wave' || action === 'noise-rain') {
            const kind = action === 'noise-wave' ? 'wave' : 'rain';
            if (petNoiseKind === kind) { petNoiseStop(); petSay('白噪音停了,安静会儿', 2000); }
            else { petNoiseStart(kind); petSay(kind === 'wave' ? '🌊 海浪声响起,陪你干活' : '🌧 雨声淅沥,陪你干活', 2600); }
            petMenuShowRefreshNoise();
        } else if (action === 'fish') {
            petFish();
            if (window.navBasketOpen) window.navBasketOpen('basket');
        } else if (action === 'weather') {
            petWeather();
        } else if (action === 'dailyen') {
            petDailyEn();
        } else if (action === 'say') {
            petSay();
        } else if (action === 'notifytest') {
            const r = petNotify('小鲸鱼', '通知通道正常,可以在这儿叫我啦');
            if (r === 'pending') petSay('浏览器问你要通知权限,点允许就行~', 4000, PET_BUBBLE_PRIO.work);
            else if (r === 'off') petSay('先去设置勾上「任务完成系统通知」,我才能弹到桌面~', 4200, PET_BUBBLE_PRIO.work);
            else if (r === 'denied') petSay('浏览器把通知权限拒了,去地址栏左边改一下~', 4200, PET_BUBBLE_PRIO.work);
        } else if (action === 'cmdhelp') {
            petCommand('/help');
        } else if (action === 'aichat') {
            setTimeout(window.petAiQuickOpen, 0);   // 避开本次 click 冒泡:点外关闭监听会把刚开的气泡立刻关掉
        } else if (action === 'chatwin') {
            setTimeout(function() { window.petAiChatOpen('window'); }, 0);
        } else if (action === 'localai') {
            if (window.openGuestLocalAiPanel) window.openGuestLocalAiPanel();
        } else if (action === 'balance') {
            petAiBalance();
        } else if (action === 'stats') {
            if (window.NAV_GUEST_MODE && window.navGuestStatsOpen) window.navGuestStatsOpen();
            else petStats();
        } else if (action === 'home') {
            const pet = document.getElementById('navPet');
            if (pet) {
                const hy = Math.round(window.innerHeight * 0.72);
                pet.style.left = '28px'; pet.style.top = hy + 'px';
                localStorage.setItem('navPetX', 28); localStorage.setItem('navPetY', hy);
                petSay('回家咯~', 1800);
                petBeep('ding');
            }
        } else if (action === 'whisper') {
            const off = localStorage.getItem('navPetWhisper') === '0';
            localStorage.setItem('navPetWhisper', off ? '1' : '0');
            petSay(off ? '好耶,我又可以说话啦' : '好吧,我闭嘴', 2000);
        } else if (action === 'off') {
            const cb = document.getElementById('setPetOn');
            if (cb) { cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true })); }
        }
    }
    // ===== 积分商店(2026-10-25 brainstorm 落地):攒的积分能花了;纯本机,零 AI =====
    // navPetShop = {spent: 已花积分, gold: 金色体色, hats: [已购帽子], rare: 稀有动作包}
    // 等级用累计积分(sign.score),消费不减等级——可用积分 = score - spent
    const PET_SHOP_ITEMS = [
        {key: 'gold', kind: 'toggle', name: '✨ 金色体色', price: 300, desc: '给小鲸鱼镀一层金(纯滤镜,不换素材)'},
        {key: 'hat:🧢', kind: 'hat', name: '🧢 棒球帽', price: 150, desc: '休闲风'},
        {key: 'hat:🎓', kind: 'hat', name: '🎓 学士帽', price: 200, desc: '学霸风'},
        {key: 'hat:🎩', kind: 'hat', name: '🎩 礼帽', price: 300, desc: '绅士风'},
        {key: 'hat:👑', kind: 'hat', name: '👑 皇冠', price: 500, desc: '传奇鲸标配'},
        {key: 'rare', kind: 'toggle', name: '🎬 稀有动作包', price: 800, desc: '动作点播弹窗解锁「✨ 稀有」组(蓝鲸现世/凭空生花/扑克魔术/鲸鱼吐泡泡)'}
    ];
    function petShopData() {
        let s = null;
        try { s = JSON.parse(localStorage.getItem('navPetShop') || 'null'); } catch (e) { s = null; }
        if (!s || typeof s !== 'object') s = {spent: 0, gold: false, hats: [], rare: false};
        if (typeof s.spent !== 'number') s.spent = 0;
        if (!Array.isArray(s.hats)) s.hats = [];
        return s;
    }
    function petShopSave(s) { localStorage.setItem('navPetShop', JSON.stringify(s)); }
    function petShopAfford() { return Math.max(0, petSignData().score - petShopData().spent); }
    function petShopOwned(s, key) {
        if (key === 'gold') return !!s.gold;
        if (key === 'rare') return !!s.rare;
        return s.hats.indexOf(key.slice(4)) !== -1;   // hat:🧢 → 🧢
    }
    // 应用商店外观:金色滤镜 + 帽子(挂在 #navPet 顶上,随体型缩放)
    function petApplyShopLook() {
        const pet = document.getElementById('navPet');
        if (!pet) return;
        const video = pet.querySelector('.nav-pet-video');
        if (video) video.style.filter = petShopData().gold ? 'sepia(.45) saturate(1.55) hue-rotate(-12deg) brightness(1.06)' : '';
        let hat = pet.querySelector('.nav-pet-hat');
        const emoji = localStorage.getItem('navPetHat') || '';
        if (emoji && !hat) {
            hat = document.createElement('span');
            hat.className = 'nav-pet-hat';
            pet.appendChild(hat);
        }
        if (hat) hat.textContent = emoji;
    }
    let petShopModal = null;
    function petShopRender() {
        if (!petShopModal) return;
        petShopModal.querySelector('#navPetShopPts').textContent = petShopAfford();
        const s = petShopData();
        petShopModal.querySelector('#navPetShopList').innerHTML = PET_SHOP_ITEMS.map(function(it, i) {
            const owned = petShopOwned(s, it.key);
            let op;
            if (it.kind === 'hat') {
                const equipped = (localStorage.getItem('navPetHat') || '') === it.key.slice(4);
                op = owned
                    ? '<button class="btn btn-sm ' + (equipped ? 'btn-success' : 'btn-outline-success') + ' py-0 px-2" data-shop-equip="' + i + '">' + (equipped ? '戴着' : '戴上') + '</button>'
                    : '<button class="btn btn-sm btn-primary py-0 px-2" data-shop-buy="' + i + '">买 ' + it.price + '</button>';
            } else {
                op = owned
                    ? '<button class="btn btn-sm btn-success py-0 px-2" data-shop-equip="' + i + '">' + (s[it.key] ? '已启用(点关)' : '已购(点开)') + '</button>'
                    : '<button class="btn btn-sm btn-primary py-0 px-2" data-shop-buy="' + i + '">买 ' + it.price + '</button>';
            }
            return '<div class="d-flex align-items-center gap-2 py-1 border-bottom">' +
                '<div class="flex-grow-1 min-w-0"><div class="small fw-bold">' + it.name + ' <span class="text-muted fw-normal">' + it.price + ' 分</span></div>' +
                '<div class="text-muted" style="font-size:.72rem">' + it.desc + '</div></div>' + op + '</div>';
        }).join('');
    }
    function petShopOpen() {
        if (!petShopModal) { petShopBuild(); }
        petShopRender();
        bootstrap.Modal.getOrCreateInstance(petShopModal).show();
    }
    function petShopBuild() {
        petShopModal = document.createElement('div');
        petShopModal.id = 'navPetShopModal';
        petShopModal.className = 'modal';
        petShopModal.tabIndex = -1;
        petShopModal.innerHTML =
            '<div class="modal-dialog modal-sm modal-dialog-centered"><div class="modal-content">' +
            '<div class="modal-header"><h6 class="modal-title">🛒 积分商店 <span class="badge bg-success ms-1">可用 <span id="navPetShopPts">0</span> 分</span></h6>' +
            '<button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>' +
            '<div class="modal-body" style="max-height:60vh;overflow-y:auto"><div id="navPetShopList"></div>' +
            '<div class="form-text mt-2">积分来源:签到/互动/喂食/开站/星标;消费不减等级,放心花。</div>' +
            '</div></div></div>';
        document.body.appendChild(petShopModal);
        petShopModal.addEventListener('click', function(e) {
            const buy = e.target.closest('[data-shop-buy]');
            const equip = e.target.closest('[data-shop-equip]');
            if (buy) petShopBuy(parseInt(buy.getAttribute('data-shop-buy'), 10));
            else if (equip) petShopEquip(parseInt(equip.getAttribute('data-shop-equip'), 10));
        });
    }
    function petShopBuy(i) {
        const it = PET_SHOP_ITEMS[i];
        const s = petShopData();
        if (petShopOwned(s, it.key)) return;
        if (petShopAfford() < it.price) {
            petSay('积分还差 ' + (it.price - petShopAfford()) + ' 分…多摸摸我攒攒~', 3200);
            petBeep('pick');
            return;
        }
        s.spent += it.price;
        if (it.key === 'gold') s.gold = true;
        else if (it.key === 'rare') s.rare = true;
        else s.hats.push(it.key.slice(4));
        petShopSave(s);
        petShopEquip(i, true);   // 买完即戴上/启用(不反转开关)
        window.navPetState('happy');
        petSay('🎉 买下「' + it.name + '」!花掉 ' + it.price + ' 分', 3200);
        petBeep('ding');
    }
    function petShopEquip(i, fromBuy) {
        const it = PET_SHOP_ITEMS[i];
        const s = petShopData();
        if (!petShopOwned(s, it.key)) return;
        if (it.kind === 'hat') {
            const emoji = it.key.slice(4);
            localStorage.setItem('navPetHat', (localStorage.getItem('navPetHat') || '') === emoji ? '' : emoji);
            petApplyShopLook();
            petSay(localStorage.getItem('navPetHat') ? '好看吗?这是我新买的帽子~' : '帽子摘下来了', 2200);
        } else {
            s[it.key] = fromBuy ? true : !s[it.key];   // 购买路径:直接启用;点按路径:开关切换
            petShopSave(s);
            petApplyShopLook();
            if (it.key === 'rare') { petActRenderGroups(); petSay(s.rare ? '稀有动作已解锁,去动作点播看「✨ 稀有」组!' : '稀有动作包已收起', 3000); }
        }
        petShopRender();
    }
    // ===== 动作点播弹窗(动作类整合进弹窗,菜单只留常用项——用户要求) =====
    function petModalGroup(title, names) {
        return '<div class="pet-menu-group">' + title + '</div>' +
            '<div class="d-flex flex-wrap gap-1 mb-2">' +
            names.map(function(n) {
                return '<button type="button" class="btn btn-outline-secondary btn-sm" data-pet-play="' + n + '">' + n + '</button>';
            }).join('') + '</div>';
    }
    const petActModal = document.createElement('div');
    petActModal.id = 'navPetActionsModal';
    petActModal.className = 'modal';
    petActModal.tabIndex = -1;
    petActModal.innerHTML =
        '<div class="modal-dialog modal-sm modal-dialog-centered"><div class="modal-content">' +
        '<div class="modal-header"><h6 class="modal-title">🎬 动作点播(' + PET_FUN.length + '+ 个)</h6>' +
        '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="关闭"></button></div>' +
        '<div class="modal-body" style="max-height:62vh;overflow-y:auto;"><div id="navPetActGroups"></div>' +
        '</div></div></div>';
    // 分组可重建:稀有动作包买到的当刻就要出现在点播弹窗里(不能只在加载时算一次)
    function petActRenderGroups() {
        petActModal.querySelector('#navPetActGroups').innerHTML =
            PET_GROUPS.map(function(g) { return petModalGroup(g[0], g[1]); }).join('') +
            (petShopData().rare ? petModalGroup('✨ 稀有(已解锁)', PET_RARE) : '');
    }
    petActRenderGroups();
    document.body.appendChild(petActModal);
    petActModal.addEventListener('click', function(e) {
        const btn = e.target.closest('[data-pet-play]');
        if (!btn) return;
        petPlayByName(btn.getAttribute('data-pet-play'));
        bootstrap.Modal.getOrCreateInstance(petActModal).hide();
        petSay('好嘞~', 1500);
    });
    // ===== 宠物设置弹窗(蒸馏 desk-llm-pet 可视化设置:大小/透明度实时预览) =====
    const petSetModal = document.createElement('div');
    petSetModal.id = 'navPetSettingsModal';
    petSetModal.className = 'modal';
    petSetModal.tabIndex = -1;
    petSetModal.innerHTML =
        '<div class="modal-dialog modal-sm modal-dialog-centered"><div class="modal-content">' +
        '<div class="modal-header"><h6 class="modal-title">⚙️ 宠物设置</h6>' +
        '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="关闭"></button></div>' +
        // 单页长列表(要滚一屏半、找一项得翻半天)按用途拆成 5 个页签(2026-11-18)。
        // 切换交给垫片的 data-bs-toggle="tab" 委托(active / show 由它维护),这里不 new Tab 实例;
        // 页签不加 fade —— 兼容层的 .tab-content>.fade 是 opacity:0,漏个 show 就整页空白。
        '<div class="modal-body">' +
        '<div class="nav-pet-set-tabs" role="tablist">' +
        '<button type="button" class="btn btn-sm btn-outline-secondary active" data-bs-toggle="tab" data-bs-target="#petPaneLook" role="tab" aria-selected="true">🎨 外观</button>' +
        '<button type="button" class="btn btn-sm btn-outline-secondary" data-bs-toggle="tab" data-bs-target="#petPaneAct" role="tab" aria-selected="false">🐳 互动</button>' +
        '<button type="button" class="btn btn-sm btn-outline-secondary" data-bs-toggle="tab" data-bs-target="#petPaneChat" role="tab" aria-selected="false">💬 聊天</button>' +
        '<button type="button" class="btn btn-sm btn-outline-secondary" data-bs-toggle="tab" data-bs-target="#petPaneSnd" role="tab" aria-selected="false">🔊 声音</button>' +
        '<button type="button" class="btn btn-sm btn-outline-secondary" data-bs-toggle="tab" data-bs-target="#petPaneRem" role="tab" aria-selected="false">🔔 提醒</button>' +
        '<button type="button" class="btn btn-sm btn-outline-secondary" data-bs-toggle="tab" data-bs-target="#petPaneWx" role="tab" aria-selected="false">🌤 天气</button>' +
        '</div>' +
        '<div class="tab-content">' +
        /* ① 外观:体型 / 透明度 / 气泡大小 —— 都是「看起来怎样」 */
        '<div class="tab-pane nav-pet-set-pane active" id="petPaneLook" role="tabpanel">' +
        '<label class="form-label d-flex justify-content-between">大小 <span id="navPetSizeV"></span></label>' +
        '<input type="range" class="form-range" id="navPetSizeR" min="64" max="448" step="8">' +
        '<label class="form-label d-flex justify-content-between">透明度 <span id="navPetOpacityV"></span></label>' +
        '<input type="range" class="form-range" id="navPetOpacityR" min="40" max="100" step="5">' +
        '<label class="form-label d-flex justify-content-between mt-2">💬 气泡缩放 <span id="navPetBubbleV"></span></label>' +
        '<input type="range" class="form-range" id="navPetBubbleR" min="60" max="160" step="10">' +
        '<label class="form-label d-flex justify-content-between mt-2">🔍 界面字号 <span id="navPetUiScaleV"></span></label>' +
        '<select class="form-select form-select-sm" id="navPetUiScaleSel">' +
        '<option value="auto">自动（按屏幕分辨率）</option><option value="1">100%</option>' +
        '<option value="1.15">115%</option><option value="1.3">130%</option><option value="1.5">150%</option></select>' +
        '<label class="form-label d-flex justify-content-between mt-2">⏩ 播放速度 <span id="navPetSpeedV"></span></label>' +
        '<input type="range" class="form-range" id="navPetSpeedR" min="50" max="200" step="10">' +
        '</div>' +
        /* ② 互动:说话频率 / 动作节奏 / 活动范围 —— 都是「它自己会干什么」 */
        '<div class="tab-pane nav-pet-set-pane" id="petPaneAct" role="tabpanel">' +
        '<label class="form-label" for="navPetToneSel">🗣 语气程度</label>' +
        '<select class="form-select form-select-sm" id="navPetToneSel">' +
        '<option value="quiet">安静(少说话少动)</option><option value="std">标准</option>' +
        '<option value="lively">活泼(话痨 + 爱动)</option></select>' +
        '<label class="form-label mt-2" for="navPetWhisperSel">💬 碎碎念频率</label>' +
        '<select class="form-select form-select-sm" id="navPetWhisperSel">' +
        '<option value="0">关闭</option><option value="5">每 5 分钟</option>' +
        '<option value="15">每 15 分钟</option><option value="30">每 30 分钟</option>' +
        '<option value="60">每 60 分钟</option></select>' +
        '<label class="form-label mt-2" for="navPetIdleSel">💤 闲置动作间隔</label>' +
        '<select class="form-select form-select-sm" id="navPetIdleSel">' +
        '<option value="1">每 1 分钟</option><option value="3">每 3 分钟</option>' +
        '<option value="5">每 5 分钟</option><option value="10">每 10 分钟</option></select>' +
        '<label class="form-label mt-2">💤 闲置动作来源</label>' +
        '<div class="d-flex flex-wrap gap-2" style="font-size:.75rem;">' +
        '<div class="form-check"><input class="form-check-input" type="checkbox" id="navPetIpIdle"><label class="form-check-label" for="navPetIpIdle">待机</label></div>' +
        '<div class="form-check"><input class="form-check-input" type="checkbox" id="navPetIpPlay"><label class="form-check-label" for="navPetIpPlay">玩耍</label></div>' +
        '<div class="form-check"><input class="form-check-input" type="checkbox" id="navPetIpEat"><label class="form-check-label" for="navPetIpEat">吃饭</label></div>' +
        '<div class="form-check"><input class="form-check-input" type="checkbox" id="navPetIpShow"><label class="form-check-label" for="navPetIpShow">表演</label></div>' +
        '<div class="form-check"><input class="form-check-input" type="checkbox" id="navPetIpFest"><label class="form-check-label" for="navPetIpFest">节日</label></div>' +
        '</div>' +
        '<label class="form-label mt-2" for="navPetWalkSel">🚶 自动散步</label>' +
        '<select class="form-select form-select-sm" id="navPetWalkSel">' +
        '<option value="0">不散步(手动点菜单)</option><option value="5">每 5 分钟</option>' +
        '<option value="10">每 10 分钟</option><option value="20">每 20 分钟</option></select>' +
        '<div class="form-check form-switch mt-2">' +
        '<input class="form-check-input" type="checkbox" id="navPetCalmCk">' +
        '<label class="form-check-label" for="navPetCalmCk">🧘 减少动态(关掉浮动/挤压动画)</label></div>' +
        '</div>' +
        // ③ 聊天:人设 / 记忆轮数 / 碎碎念走 AI(2026-11-19 从 AI 接口弹窗搬来)+ 聊天窗渲染开关
        //   人设与记忆存服务端(和接口配置同一张表),所以要一个明确的小保存按钮;
        //   碎碎念开关只是本机行为,勾选即生效。
        '<div class="tab-pane nav-pet-set-pane" id="petPaneChat" role="tabpanel">' +
        '<label class="form-label" for="petAiPersona">🧠 桌宠人设</label>' +
        '<textarea id="petAiPersona" class="form-control form-control-sm" rows="3" maxlength="2000" placeholder="例：你是一个爱吐槽的程序员鲸鱼，说话简短毒舌但心软。"></textarea>' +
        '<div class="form-text">只影响小鲸鱼说话的风格；空 = 默认女仆小鲸鱼。</div>' +
        '<label class="form-label mt-2" for="petAiRounds">🗂 记忆轮数</label>' +
        '<input id="petAiRounds" type="number" min="0" max="20" value="5" class="form-control form-control-sm" style="width:92px" aria-label="记忆对话轮数">' +
        '<div class="form-text">0 = 只记当前这句，最多 20 轮。</div>' +
        '<label class="form-label mt-2" for="petAiModelPet">🛠 桌宠模型</label>' +
        '<div class="input-group input-group-sm" style="position:relative">' +
        '<input id="petAiModelPet" class="form-control form-control-sm" placeholder="默认（跟随主模型）" autocomplete="off">' +
        '<button class="btn btn-outline-secondary" type="button" id="petAiModelPetBtn" data-bs-toggle="dropdown" aria-expanded="false" title="从检测到的模型里选">▾</button>' +
        '<div class="dropdown-menu" id="petAiModelPetMenu" style="top:100%;right:0;left:auto;min-width:100%;width:max-content;max-width:min(520px,92vw);max-height:260px;overflow:auto"></div>' +
        '</div>' +
        '<div class="form-text">只影响桌宠聊天/碎碎念；留空 = 跟随默认模型。</div>' +
        '<div class="form-check form-switch mt-2">' +
        '<input class="form-check-input" type="checkbox" id="petAiWhisperOn">' +
        '<label class="form-check-label" for="petAiWhisperOn">碎碎念走 AI（按碎碎念频率触发）</label></div>' +
        '<div class="d-flex align-items-center gap-2 mt-2 flex-wrap">' +
        '<button type="button" class="btn btn-sm btn-outline-secondary" id="navPetPersonaSave">保存桌宠设置</button>' +
        '<span class="small text-muted" id="navPetPersonaHint" aria-live="polite"></span></div>' +
        '<hr class="my-3">' +
        '<div class="form-check form-switch">' +
        '<input class="form-check-input" type="checkbox" id="navPetChatReasoningCk">' +
        '<label class="form-check-label" for="navPetChatReasoningCk">🧠 显示「思考详情」</label></div>' +
        '<div class="form-text">关掉后聊天窗口不再出现思考折叠行,回复本身照常显示。</div>' +
        '<div class="form-check form-switch mt-2">' +
        '<input class="form-check-input" type="checkbox" id="navPetChatCopyCk">' +
        '<label class="form-check-label" for="navPetChatCopyCk">📋 回复下方显示「复制」按钮</label></div>' +
        '<div class="form-text">默认不显示;打开后每条回复(以及思考块)下方多一个复制按钮。</div>' +
        '<hr class="my-3">' +
        '<div class="d-flex align-items-center gap-2 flex-wrap">' +
        '<button type="button" class="btn btn-sm btn-link text-danger p-0 text-decoration-none" id="navPetChatClearInSet">清空聊天记录（本机）</button>' +
        '<span class="small text-muted" id="navPetChatClearHint" aria-live="polite"></span></div>' +
        '</div>' +
        /* ④ 声音:音效开关/音量/界面 whoosh/朗读 */
        '<div class="tab-pane nav-pet-set-pane" id="petPaneSnd" role="tabpanel">' +
        '<div class="form-check form-switch">' +
        '<input class="form-check-input" type="checkbox" id="navPetSoundCk">' +
        '<label class="form-check-label" for="navPetSoundCk">🔔 8bit 音效</label></div>' +
        '<label class="form-label d-flex justify-content-between">音量 <span id="navPetVolV"></span></label>' +
        '<input type="range" class="form-range" id="navPetVolR" min="10" max="100" step="5">' +
        '<div class="form-check form-switch mt-2">' +
        '<input class="form-check-input" type="checkbox" id="navPetUiSoundCk">' +
        '<label class="form-check-label" for="navPetUiSoundCk">♫ 界面开合音效(弹窗/抽屉/下拉 whoosh)</label></div>' +
        '<div class="form-check form-switch mt-2">' +
        '<input class="form-check-input" type="checkbox" id="navPetSpeakCk">' +
        '<label class="form-check-label" for="navPetSpeakCk">🗣 朗读气泡(浏览器语音,免 key)</label></div>' +
        '</div>' +
        /* ⑤ 提醒:加载问候 / 整点报时 / 任务完成通知 */
        '<div class="tab-pane nav-pet-set-pane" id="petPaneRem" role="tabpanel">' +
        '<div class="form-check form-switch">' +
        '<input class="form-check-input" type="checkbox" id="navPetGreetCk">' +
        '<label class="form-check-label" for="navPetGreetCk">👋 加载问候 + 每日推荐</label></div>' +
        '<div class="form-check form-switch mt-2">' +
        '<input class="form-check-input" type="checkbox" id="navPetChimeCk">' +
        '<label class="form-check-label" for="navPetChimeCk">⏰ 整点报时</label></div>' +
        '<div class="form-check form-switch mt-2">' +
        '<input class="form-check-input" type="checkbox" id="navPetNotifyCk">' +
        '<label class="form-check-label" for="navPetNotifyCk">🔔 任务完成系统通知</label></div>' +
        '</div>' +
        /* ⑥ 天气:省市两连选 + 手动输入 */
        '<div class="tab-pane nav-pet-set-pane" id="petPaneWx" role="tabpanel">' +
        '<label class="form-label">🌤 天气城市(中国城市列表)</label>' +
        '<div class="d-flex gap-1 mb-1">' +
        '<select class="form-select form-select-sm" id="navPetProvSel" title="选省"></select>' +
        '<select class="form-select form-select-sm" id="navPetCitySel" title="选市,选中即生效并记住经纬度"></select>' +
        '</div>' +
        '<label class="form-label" for="navPetCityIn">或手动输入(海外/列表外城市,走地名解析)</label>' +
        '<input type="text" class="form-control form-control-sm" id="navPetCityIn" placeholder="城市名,如 广州">' +
        '<div class="form-text">问天气用;数据来自中国气象局 weather.cma.cn(免 key,国内实测 0.2 秒),海外城市回落 Open-Meteo。重名/区县名会自动消歧,气泡里显示解析到哪(如「朝阳→朝阳区·北京市」)</div>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '<div class="modal-footer">' +
        '<button type="button" class="btn btn-outline-secondary btn-sm" id="navPetLookReset">恢复默认</button>' +
        '<button type="button" class="btn btn-primary btn-sm" data-bs-dismiss="modal">完成</button>' +
        '</div></div></div>';
    document.body.appendChild(petSetModal);
    // 设置弹窗自己做一套拖拽缩放(不依赖垫片):右下角给一个看得见的抓手,
    // 标题栏拖动仍由 bootstrap-shim 的 uiMakeMovable 负责(所有弹窗统一)。
    (function petSettingsResizable() {
        const dialog = petSetModal.querySelector('.modal-dialog');
        if (!dialog) return;
        const setHeader = petSetModal.querySelector('.modal-header');
        if (setHeader) setHeader.title = '按住标题栏拖动窗口；右下角可调整大小';
        dialog.style.resize = 'both';
        // 弹窗自己不再滚动(内容由 .modal-body 滚):overflow:auto 会多出一条系统白滚动条,
        // 截图里就在右边站着(2026-11-19);hidden 同样能保住右下角 resize 抓手。
        dialog.style.overflow = 'hidden';
        dialog.style.pointerEvents = 'auto';
        dialog.style.maxWidth = 'none';
        const grip = document.createElement('div');
        grip.className = 'nav-pet-resize-grip';
        grip.title = '拖动调整设置窗口大小';
        grip.setAttribute('aria-label', '拖动调整设置窗口大小');
        dialog.appendChild(grip);
        grip.addEventListener('pointerdown', function(ev) {
            ev.preventDefault();
            ev.stopPropagation();
            const sx = ev.clientX, sy = ev.clientY;
            const rect = dialog.getBoundingClientRect();
            const top = rect.top;
            function move(e) {
                const maxW = Math.max(320, window.innerWidth - 16);
                const maxH = Math.max(260, window.innerHeight - top - 10);
                dialog.style.width = Math.min(maxW, Math.max(320, rect.width + e.clientX - sx)) + 'px';
                dialog.style.height = Math.min(maxH, Math.max(320, rect.height + e.clientY - sy)) + 'px';
            }
            function up() {
                document.removeEventListener('pointermove', move);
                document.removeEventListener('pointerup', up);
            }
            document.addEventListener('pointermove', move);
            document.addEventListener('pointerup', up, {once: true});
        });
    })();
    // 页签记忆(2026-11-18):上次停在哪一页,下次打开原地回来。
    // 用 dispatch click 而不是直接改 class —— 切换逻辑(含 pane 的 active/show)只有垫片那一条路径,
    // 不另造第二套;aria-selected 垫片不维护,这里补。
    function petSetTabRestore() {
        let want = '';
        try { want = localStorage.getItem('navPetSetTab') || ''; } catch (e) { want = ''; }
        const btn = want ? petSetModal.querySelector('[data-bs-target="' + want + '"]') : null;
        if (btn && !btn.classList.contains('active')) btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    petSetModal.addEventListener('shown.bs.tab', function(e) {
        const t = e.target.getAttribute && e.target.getAttribute('data-bs-target');
        if (t) { try { localStorage.setItem('navPetSetTab', t); } catch (err) {} }
        petSetModal.querySelectorAll('.nav-pet-set-tabs [data-bs-toggle="tab"]').forEach(function(b) {
            b.setAttribute('aria-selected', b === e.target ? 'true' : 'false');
        });
    });
    // 每次打开都回填一遍:从聊天齿轮「宠物设置…」进来时也能看到真实的开关状态(2026-11-19)
    petSetModal.addEventListener('show.bs.modal', function() { petSettingsSync(); petPersonaLoad(); });
    const petSizeR = petSetModal.querySelector('#navPetSizeR');
    const petSizeV = petSetModal.querySelector('#navPetSizeV');
    const petOpR = petSetModal.querySelector('#navPetOpacityR');
    const petOpV = petSetModal.querySelector('#navPetOpacityV');
    const petWsSel = petSetModal.querySelector('#navPetWhisperSel');
    const petSoundCk = petSetModal.querySelector('#navPetSoundCk');
    const petVolR = petSetModal.querySelector('#navPetVolR');
    const petVolV = petSetModal.querySelector('#navPetVolV');
    const petGreetCk = petSetModal.querySelector('#navPetGreetCk');
    const petChimeCk = petSetModal.querySelector('#navPetChimeCk');
    const petNotifyCk = petSetModal.querySelector('#navPetNotifyCk');
    const petSpeakCk = petSetModal.querySelector('#navPetSpeakCk');
    const petUiSoundCk = petSetModal.querySelector('#navPetUiSoundCk');
    const petBubbleR = petSetModal.querySelector('#navPetBubbleR');
    const petBubbleV = petSetModal.querySelector('#navPetBubbleV');
    const petUiScaleSel = petSetModal.querySelector('#navPetUiScaleSel');
    const petChatReasoningCk = petSetModal.querySelector('#navPetChatReasoningCk');
    const petChatCopyCk = petSetModal.querySelector('#navPetChatCopyCk');
    const petUiScaleV = petSetModal.querySelector('#navPetUiScaleV');
    function petUiScaleSync() {
        const cur = localStorage.getItem('navPetUiScale') || 'auto';
        petUiScaleSel.value = cur;
        const eff = Math.round(petUiScale() * 100);
        petUiScaleV.textContent = cur === 'auto' ? ('自动 · ' + eff + '%') : (eff + '%');
    }
    petUiScaleSel.addEventListener('change', function() {
        localStorage.setItem('navPetUiScale', petUiScaleSel.value);
        petUiScaleSync();
        if (pet && pet._petApplyLook) pet._petApplyLook();
    });
    petUiScaleSync();
    const petCityIn = petSetModal.querySelector('#navPetCityIn');
    const petProvSel = petSetModal.querySelector('#navPetProvSel');
    const petCitySel = petSetModal.querySelector('#navPetCitySel');
    // 省市两连选(数据来自 china-cities.js):选中即存 城市+经纬度,天气直接连线不查地名
    function petCitySelSync() {
        const provs = window.PET_CN_CITIES || {};
        const curCity = (localStorage.getItem('navPetCity') || '广州').trim() || '广州';
        let curProv = '';
        Object.keys(provs).forEach(function(pname) {
            if (provs[pname].some(function(c) { return c[0] === curCity; })) curProv = pname;
        });
        petProvSel.innerHTML = Object.keys(provs).map(function(pname) {
            return '<option' + (pname === curProv ? ' selected' : '') + '>' + pname + '</option>';
        }).join('') + (curProv ? '' : '<option selected>(列表外城市)</option>');
        const cities = provs[curProv] || [];
        petCitySel.innerHTML = cities.map(function(c) {
            return '<option value="' + c[0] + '|' + c[1] + '|' + c[2] + '"' + (c[0] === curCity ? ' selected' : '') + '>' + c[0] + '</option>';
        }).join('') + (curProv ? '' : '<option selected>' + curCity + '</option>');
    }
    petProvSel.addEventListener('change', function() {
        const cities = (window.PET_CN_CITIES || {})[petProvSel.value] || [];
        petCitySel.innerHTML = cities.map(function(c) {
            return '<option value="' + c[0] + '|' + c[1] + '|' + c[2] + '">' + c[0] + '</option>';
        }).join('');
        if (cities.length) {
            petCitySel.dispatchEvent(new Event('change', {bubbles: true}));
        }
    });
    petCitySel.addEventListener('change', function() {
        const parts = (petCitySel.value || '').split('|');
        if (parts.length < 3) return;   // (列表外城市) 占位,不动
        localStorage.setItem('navPetCity', parts[0]);
        localStorage.setItem('navPetCityLat', parts[1]);
        localStorage.setItem('navPetCityLon', parts[2]);
        localStorage.setItem('navPetCitySrc', 'picker');
        localStorage.setItem('navPetGeoAt', String(Date.now()));
        petCityIn.value = parts[0];
    });
    const petSpeedR = petSetModal.querySelector('#navPetSpeedR');
    const petSpeedV = petSetModal.querySelector('#navPetSpeedV');
    const petToneSel = petSetModal.querySelector('#navPetToneSel');
    const petCalmCk = petSetModal.querySelector('#navPetCalmCk');
    const petWalkSel = petSetModal.querySelector('#navPetWalkSel');
    const petIdleSel = petSetModal.querySelector('#navPetIdleSel');
    const petIpCks = {
        idle: petSetModal.querySelector('#navPetIpIdle'),
        play: petSetModal.querySelector('#navPetIpPlay'),
        eat: petSetModal.querySelector('#navPetIpEat'),
        show: petSetModal.querySelector('#navPetIpShow'),
        festival: petSetModal.querySelector('#navPetIpFest')
    };
    function petSettingsSync() {
        const size = parseInt(localStorage.getItem('navPetSize'), 10) || petTier().size;
        const op = parseFloat(localStorage.getItem('navPetOpacity'));
        const opPct = Math.round((isNaN(op) ? 1 : op) * 100);
        const bs = Math.round((parseFloat(localStorage.getItem('navPetBubbleScale')) || 1) * 100);
        petSizeR.value = size; petSizeV.textContent = size + 'px';
        petOpR.value = opPct; petOpV.textContent = opPct + '%';
        petBubbleR.value = bs; petBubbleV.textContent = bs + '%';
        const mins = parseInt(localStorage.getItem('navPetWhisperMin'), 10);
        petWsSel.value = String(isNaN(mins) ? 5 : mins);
        petSoundCk.checked = localStorage.getItem('navPetSound') !== '0';
        const vol = Math.round(Math.min(1, Math.max(0.05, parseFloat(localStorage.getItem('navPetSoundVol')) || 0.3)) * 100);
        petVolR.value = vol; petVolV.textContent = vol + '%';
        petGreetCk.checked = localStorage.getItem('navPetGreet') !== '0';
        petChimeCk.checked = localStorage.getItem('navPetChime') !== '0';
        petNotifyCk.checked = localStorage.getItem('navPetNotify') === '1';
        petSpeakCk.checked = localStorage.getItem('navPetSpeak') === '1';
        petUiSoundCk.checked = localStorage.getItem('navPetUiSound') === '1';
        // 聊天窗口的两个渲染开关:思考详情默认显示,复制按钮默认不显示(2026-11-19)
        petChatReasoningCk.checked = localStorage.getItem('navPetChatReasoning') !== '0';
        petChatCopyCk.checked = localStorage.getItem('navPetChatCopy') === '1';
        // 碎碎念走 AI 是本机开关,跟着 localStorage 回填(2026-11-19 从 AI 接口弹窗搬来)
        const petWhisperOn = petSetModal.querySelector('#petAiWhisperOn');
        if (petWhisperOn) petWhisperOn.checked = localStorage.getItem('navPetAiWhisper') === '1';
        petCityIn.value = localStorage.getItem('navPetCity') || '广州';
        if (window.PET_CN_CITIES) petCitySelSync();
        const spd = Math.round((parseFloat(localStorage.getItem('navPetSpeed')) || 1) * 100);
        petSpeedR.value = spd; petSpeedV.textContent = (spd / 100).toFixed(1) + 'x';
        petToneSel.value = localStorage.getItem('navPetTone') || 'std';
        petCalmCk.checked = localStorage.getItem('navPetCalm') === '1';
        petWalkSel.value = localStorage.getItem('navPetAutoWalk') || '0';
        petIdleSel.value = localStorage.getItem('navPetIdleMin') || '3';
        let ip = null;
        try { ip = JSON.parse(localStorage.getItem('navPetIdlePools') || 'null'); } catch (e) { ip = null; }
        if (!Array.isArray(ip)) ip = ['idle', 'play'];
        Object.keys(petIpCks).forEach(function(k) { petIpCks[k].checked = ip.indexOf(k) >= 0; });
    }
    petSizeR.addEventListener('input', function() {
        petSizeV.textContent = petSizeR.value + 'px';
        localStorage.setItem('navPetSize', petSizeR.value);
        const pet = document.getElementById('navPet');
        if (pet && pet._petApplyLook) pet._petApplyLook();   // 实时预览
    });
    petOpR.addEventListener('input', function() {
        petOpV.textContent = petOpR.value + '%';
        localStorage.setItem('navPetOpacity', String(petOpR.value / 100));
        const pet = document.getElementById('navPet');
        if (pet && pet._petApplyLook) pet._petApplyLook();
    });
    petWsSel.addEventListener('change', function() {
        localStorage.setItem('navPetWhisperMin', petWsSel.value);
    });
    petSoundCk.addEventListener('change', function() {
        localStorage.setItem('navPetSound', this.checked ? '1' : '0');
        if (this.checked) petBeep('click');   // 开启即试听
    });
    petVolR.addEventListener('input', function() {
        petVolV.textContent = petVolR.value + '%';
        localStorage.setItem('navPetSoundVol', String(petVolR.value / 100));
    });
    petVolR.addEventListener('change', function() { petBeep('pop'); });   // 松手试听
    petGreetCk.addEventListener('change', function() {
        localStorage.setItem('navPetGreet', this.checked ? '1' : '0');
    });
    petChimeCk.addEventListener('change', function() {
        localStorage.setItem('navPetChime', this.checked ? '1' : '0');
    });
    petNotifyCk.addEventListener('change', function() {
        localStorage.setItem('navPetNotify', this.checked ? '1' : '0');
        if (this.checked && window.Notification && Notification.permission === 'default') Notification.requestPermission();
    });
    petSpeakCk.addEventListener('change', function() {
        localStorage.setItem('navPetSpeak', this.checked ? '1' : '0');
        if (!this.checked && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    });
    petUiSoundCk.addEventListener('change', function() {
        localStorage.setItem('navPetUiSound', this.checked ? '1' : '0');
    });
    // 聊天窗口:两个开关都是即时生效的,改完重绘一次消息列表(窗口没建时 petChatRender 直接 return)
    petChatReasoningCk.addEventListener('change', function() {
        localStorage.setItem('navPetChatReasoning', this.checked ? '1' : '0');
        petChatRender();
    });
    petChatCopyCk.addEventListener('change', function() {
        localStorage.setItem('navPetChatCopy', this.checked ? '1' : '0');
        petChatRender();
    });
    // 人设/记忆/桌宠模型搬到本页签(2026-11-19 用户要求):打开设置时从服务端回填,
    // 保存只提交 persona/memory_rounds/model_pet,不动接口地址与默认模型。
    function petPersonaLoad() {
        const p = petSetModal.querySelector('#petAiPersona');
        const r = petSetModal.querySelector('#petAiRounds');
        const mp = petSetModal.querySelector('#petAiModelPet');
        if (!p || !r) return;
        if (window.NAV_GUEST_MODE) {
            const gc = (window.navGuestAi && window.navGuestAi.config()) || {};
            if (document.activeElement !== p) p.value = gc.persona || '';
            if (document.activeElement !== r) r.value = (gc.memoryRounds == null ? 5 : gc.memoryRounds);
            if (mp && document.activeElement !== mp) mp.value = gc.modelPet || '';
            return;
        }
        fetch(PET_AI_URLS.config, {headers: {'Accept': 'application/json'}})
            .then(function(res) { return res.json(); })
            .then(function(d) {
                if (!d || d.status !== 'ok') return;
                if (document.activeElement !== p) p.value = d.persona || '';
                if (document.activeElement !== r) r.value = (d.memory_rounds == null ? 5 : d.memory_rounds);
                if (mp && document.activeElement !== mp) mp.value = d.model_pet || '';
                petAiRenderTaskModelMenus();
                petAiPrefetchModels(d.base_url);   // 桌宠设置里没有接口地址框，借已存地址补模型下拉
            }).catch(function() {});
    }
    let petPersonaBusy = false;
    function petPersonaSave() {
        const btn = petSetModal.querySelector('#navPetPersonaSave');
        const p = petSetModal.querySelector('#petAiPersona');
        const r = petSetModal.querySelector('#petAiRounds');
        const mp = petSetModal.querySelector('#petAiModelPet');
        const hint = petSetModal.querySelector('#navPetPersonaHint');
        if (!p || !r || petPersonaBusy) return;
        function say(text, cls) {
            if (hint) { hint.textContent = text; hint.className = 'small ' + (cls || 'text-muted'); }
        }
        let rounds = parseInt(r.value, 10);
        if (isNaN(rounds)) rounds = 0;
        rounds = Math.max(0, Math.min(rounds, 20));
        r.value = rounds;
        if (window.NAV_GUEST_MODE) {
            if (!window.navGuestAi || !window.navGuestAi.savePetConfig) {
                say('✗ 本机 AI 面板还没加载', 'text-danger');
                return;
            }
            petPersonaBusy = true;
            if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
            say('正在保存到本机…', 'text-muted');
            window.navGuestAi.savePetConfig({
                persona: p.value || '',
                memoryRounds: rounds,
                modelPet: mp ? (mp.value || '').trim() : ''
            }).then(function(ok) {
                petPersonaBusy = false;
                if (btn) { btn.disabled = false; btn.textContent = '保存桌宠设置'; }
                if (!ok) { say('✗ 本机存储失败，设置没有保存', 'text-danger'); return; }
                say('✓ 已保存到本机，下次对话生效', 'text-success');
                if (typeof showToast === 'function') showToast('桌宠设置已保存到本机');
            }).catch(function(err) {
                petPersonaBusy = false;
                if (btn) { btn.disabled = false; btn.textContent = '保存桌宠设置'; }
                say('✗ 保存失败：' + ((err && err.message) || '本机存储异常'), 'text-danger');
            });
            return;
        }
        petPersonaBusy = true;
        if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
        say('正在保存…', 'text-muted');
        petAiPost(PET_AI_URLS.config, {
            persona: p.value || '',
            memory_rounds: rounds,
            model_pet: mp ? (mp.value || '').trim() : ''
        }).then(function(d) {
            petPersonaBusy = false;
            if (btn) { btn.disabled = false; btn.textContent = '保存桌宠设置'; }
            if (!d || d.status !== 'ok') { say('✗ 没保存成功：' + ((d && d.message) || '服务端返回异常'), 'text-danger'); return; }
            say('✓ 已保存，下次对话生效', 'text-success');
            if (typeof showToast === 'function') showToast('桌宠设置已保存');
        }).catch(function(err) {
            petPersonaBusy = false;
            if (btn) { btn.disabled = false; btn.textContent = '保存桌宠设置'; }
            say('✗ 保存失败：' + ((err && err.message) || '网络或服务器错误'), 'text-danger');
        });
    }
    petSetModal.querySelector('#navPetPersonaSave').addEventListener('click', petPersonaSave);
    // 清空聊天记录收进设置(2026-11-19 用户要求):只清本机 localStorage,不进后端。
    // 删了不能恢复(没有服务端副本),所以先走 navConfirm;聊天窗开着就顺手重绘成空态。
    function petChatClearAll() {
        petChatHistory = [];
        petChatSaveHistory();
        if (document.getElementById('navPetChatMsgs')) petChatRender();
        const hint = petSetModal.querySelector('#navPetChatClearHint');
        if (hint) { hint.textContent = '✓ 已清空'; hint.className = 'small text-success'; }
        if (typeof showToast === 'function') showToast('聊天记录已清空');
    }
    petSetModal.querySelector('#navPetChatClearInSet').addEventListener('click', function() {
        if (typeof window.navConfirm !== 'function') { petChatClearAll(); return; }
        window.navConfirm({
            title: '清空聊天记录？',
            body: '本机上和小鲸鱼的聊天记录会被删除，无法恢复。',
            confirmLabel: '清空',
            danger: true
        }).then(function(ok) { if (ok) petChatClearAll(); });
    });
    petBubbleR.addEventListener('input', function() {
        petBubbleV.textContent = petBubbleR.value + '%';
        localStorage.setItem('navPetBubbleScale', String(petBubbleR.value / 100));
        const pet = document.getElementById('navPet');
        if (pet && pet._petApplyLook) pet._petApplyLook();   // 实时预览
    });
    petCityIn.addEventListener('change', function() {
        const v = this.value.trim();
        if (v) localStorage.setItem('navPetCity', v);
        else localStorage.removeItem('navPetCity');
        localStorage.removeItem('navPetCityLat');   // 手动输入走地名解析,别让旧经纬度抢线
        localStorage.removeItem('navPetCityLon');
        localStorage.removeItem('navPetCitySrc');
        localStorage.removeItem('navPetGeoAt');
    });
    petSpeedR.addEventListener('input', function() {
        petSpeedV.textContent = (petSpeedR.value / 100).toFixed(1) + 'x';
        localStorage.setItem('navPetSpeed', String(petSpeedR.value / 100));
        const video = document.querySelector('#navPet .nav-pet-video');   // 当前动画立即生效
        if (video) video.playbackRate = petSpeedR.value / 100;
    });
    petToneSel.addEventListener('change', function() {
        localStorage.setItem('navPetTone', petToneSel.value);
    });
    petCalmCk.addEventListener('change', function() {
        localStorage.setItem('navPetCalm', this.checked ? '1' : '0');
        const pet = document.getElementById('navPet');
        if (pet && pet._petApplyLook) pet._petApplyLook();
    });
    petWalkSel.addEventListener('change', function() {
        localStorage.setItem('navPetAutoWalk', petWalkSel.value);
    });
    petIdleSel.addEventListener('change', function() {
        localStorage.setItem('navPetIdleMin', petIdleSel.value);
    });
    Object.keys(petIpCks).forEach(function(k) {
        petIpCks[k].addEventListener('change', function() {
            const keys = Object.keys(petIpCks).filter(function(x) { return petIpCks[x].checked; });
            localStorage.setItem('navPetIdlePools', JSON.stringify(keys));
        });
    });
    petSetModal.querySelector('#navPetLookReset').addEventListener('click', function() {
        ['navPetSize', 'navPetOpacity', 'navPetBubbleScale', 'navPetSound', 'navPetSoundVol', 'navPetGreet', 'navPetCity', 'navPetSuggestDay',
         'navPetSpeed', 'navPetTone', 'navPetCalm', 'navPetAutoWalk', 'navPetIdleMin', 'navPetIdlePools', 'navPetVitals', 'navPetFestDay', 'navPetChime', 'navPetNotify', 'navPetSpeak', 'navPetHat', 'navPetShop', 'navPetUiSound', 'navPetCityLat', 'navPetCityLon', 'navPetChatReasoning', 'navPetChatCopy'].forEach(function(k) {
            localStorage.removeItem(k);
        });
        const pet = document.getElementById('navPet');
        if (pet && pet._petApplyLook) pet._petApplyLook();
        petSettingsSync();
        petSay('恢复默认身材啦', 1800);
    });
    petMenu.addEventListener('mouseover', function(e) {
        const sub = e.target.closest('.pet-sub');
        if (sub && !sub.classList.contains('open')) petSubOpen(sub);
    });

    document.addEventListener('contextmenu', function(e) {
        if (e.target.closest('#navPet')) { e.preventDefault(); petMenuShow(e.clientX, e.clientY); }
        else if (!e.target.closest('#navPetMenu')) petMenuHide();
    });
    document.addEventListener('click', function(e) {
        const item = e.target.closest('#navPetMenu [data-pet-action]');
        const subToggle = e.target.closest('.pet-sub-toggle');
        if (subToggle) {
            const sub = subToggle.closest('.pet-sub');
            if (sub.classList.contains('open')) sub.classList.remove('open');
            else petSubOpen(sub);
            return;
        }
        if (item) { petMenuHide(); petMenuRun(item.getAttribute('data-pet-action'), item); return; }
        if (!e.target.closest('#navPetMenu')) petMenuHide();
    });
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape') petMenuHide(); });
    // 60 秒心跳:闲置换动作(间隔/来源/语气可配)、自动散步、碎碎念、饿了讨食
    let petTickMins = 0, petLastHour = new Date().getHours();
    function petToneMult() {
        const t = localStorage.getItem('navPetTone');
        return t === 'quiet' ? 2 : (t === 'lively' ? 0.5 : 1);
    }
    function petIdlePoolNames() {
        let keys = null;
        try { keys = JSON.parse(localStorage.getItem('navPetIdlePools') || 'null'); } catch (e) { keys = null; }
        if (!Array.isArray(keys) || !keys.length) keys = ['idle', 'play'];
        const unlocked = petIdleUnlocked();
        keys = keys.filter(function(k) { return unlocked.indexOf(k) !== -1; });   // 未进化的池不参与闲置轮换(点播仍可)
        if (!keys.length) keys = [petTier().pools[0]];
        const names = [];
        keys.forEach(function(k) { if (Array.isArray(PET_POOL[k])) names.push.apply(names, PET_POOL[k]); });
        return names.length ? names : PET_POOL.idle;
    }
    setInterval(function() {
        if (document.hidden || localStorage.getItem('navPetOn') === '0') return;
        // 睡着就完全安静(上游约定:睡觉拦截碎碎念/余额/工作状态/待办),钟点报时也不打扰
        const petAsleepNow = document.getElementById('navPet');
        if (petAsleepNow && petAsleepNow.dataset.sleeping === '1') return;
        if (window.petBaifanBusy) return;   // 吃白饭演出中:心跳别来点播打断
        petTickMins += 1;
        // 整点报时(开关控制;语气安静不报)
        const nowH = new Date().getHours();
        if (nowH !== petLastHour) {
            petLastHour = nowH;
            const idlePet0 = document.getElementById('navPet');
            if (localStorage.getItem('navPetChime') !== '0' && localStorage.getItem('navPetTone') !== 'quiet'
                && idlePet0 && !idlePet0.dataset.manualSleep) {
                petSay('⏰ 现在 ' + nowH + ' 点啦', 2600);
                petBeep('greet');
            }
        }
        const idlePet = document.getElementById('navPet');
        // 闲置自动打盹(5 分钟无操作;任何活动/点它会醒)
        if (idlePet && !idlePet.dataset.sleeping && !idlePet.dataset.manualSleep && Date.now() - petLastActive > petIdleSleepMs()) {
            petSleep(true);   // 自动打盹也走三段(睡下 → 循环),不动手动标记,一动就醒
        }
        const idleGap = Math.max(1, Math.round((parseInt(localStorage.getItem('navPetIdleMin'), 10) || 3) * petToneMult()));
        if (petTickMins % idleGap === 0) {
            const names = petIdlePoolNames();
            petPlayByName(names[Math.floor(Math.random() * names.length)]);
        }
        const walkGap = parseInt(localStorage.getItem('navPetAutoWalk'), 10) || 0;
        if (walkGap > 0 && petTickMins % walkGap === 0) petWalk();   // 自动散步(允许行走)
        if (localStorage.getItem('navPetWhisper') !== '0') {
            const mins = parseInt(localStorage.getItem('navPetWhisperMin'), 10);
            const v = petVitals();
            if (v.energy < 15 && Math.random() < 0.4) petSay('肚子空空…喂喂我吧~', 2600);   // 饿了讨食
            else if (mins !== 0) {   // 宠物设置里选了「关闭」(0)就彻底不念;旧代码 max(1,0)=1 反而每分钟念
                const freq = Math.max(1, Math.round((isNaN(mins) ? 5 : mins) * petToneMult()));
                if (petTickMins % freq === 0) {
                    if (localStorage.getItem('navPetAiWhisper') === '1') petAiWhisper();   // AI 碎碎念(失败静默回落本地)
                    else petSay();
                }
            }
        }
    }, 60000);
    $('#setPetOn').on('change', function() {
        localStorage.setItem('navPetOn', this.checked ? '1' : '0');
        navPetMount();
        navPetSyncToggle();
        showToast(this.checked ? '桌宠回来啦' : '桌宠已收起(设置里随时叫回来)');
    });

    // 面板每次打开都重新对齐一次;别的标签页改了开关也同步
    $('#navSettingsMenu').on('show.bs.offcanvas', navPetSyncToggle);
    window.addEventListener('storage', function(e) {
        if (e.key !== 'navPetOn') return;
        navPetMount();
        navPetSyncToggle();
    });
    navPetSyncToggle();

    // ===== 桌宠 AI(移植 dsh-pet):配置 / 聊天输入气泡 / AI 碎碎念 / 余额 =====
    // 未接 API 一切照旧:聊天入口会提示去配置,碎碎念静默回落本地语录。
    let petAiReady = null;          // null=未探测;true/false=接口是否已配置
    // 访客态不探测主人 AI 配置:只看本机自带 Key 的配置(模块加载后广播事件)。
    if (window.NAV_GUEST_MODE) {
        petAiReady = false;
        window.addEventListener('nav-guest-ai-config', function() {
            petAiReady = !!(window.navGuestAi && window.navGuestAi.configured());
        });
    } else {
        fetch(PET_AI_URLS.config).then(r => r.json()).then(function(d) {
            petAiReady = !!d.configured;
        }).catch(function() {});
    }
    let petAiBusy = false;          // 聊天/碎碎念请求进行中(防重入)
    function petAiPost(url, data) {
        return fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-CSRFToken': csrf()},
                           body: JSON.stringify(data || {})}).then(function(r) {
            // 2026-11-19:非 JSON 响应(500 的 HTML 页 / CSRF 403)以前会在 .json() 里抛一个
            // 没头没尾的错误,前端只能显示「请求失败」。这里把状态码翻成人话。
            return r.text().then(function(txt) {
                let d = null;
                try { d = JSON.parse(txt); } catch (e) { d = null; }
                if (d) return d;
                if (r.status === 403) throw new Error('登录/校验已过期（403），刷新页面后重试');
                throw new Error('服务器返回 ' + r.status + '（不是 JSON）');
            });
        });
    }
    // 余额只对 DeepSeek 官方接口有意义:本地网关/本地 Ollama 没有 /user/balance,
    // 按钮露出来只会让人点出一个 404(2026-11-19:接口放宽到 Key 可空之后更明显)
    function petAiBalanceApplicable(base) {
        return /^https:\/\/api\.deepseek\.com/i.test(String(base || '').trim());
    }
    function petAiMarkStatus(configured, model, base) {
        petAiReady = !!configured;
        const badge = document.getElementById('petAiStatus');
        if (badge) {
            badge.textContent = configured ? ('已配置：' + (model || '')) : '接口未配置 · 不影响桌宠其他玩法';
            badge.className = 'badge ' + (configured ? 'bg-success' : 'bg-secondary') + ' ms-1';
        }
        const bb = document.getElementById('petAiBalanceBtn');
        if (bb) {
            bb.style.display = (configured && petAiBalanceApplicable(base || petAiBaseNow())) ? '' : 'none';
        }
    }
    // 最近一次探活结果(存在服务端):关掉弹窗再打开也能看到上次为什么不可用
    function petAiRenderDiag(d) {
        const el = document.getElementById('petAiDiag');
        if (!el) return;
        if (!d || typeof d.last_check_at === 'undefined') return;   // 端点没带诊断字段时别误清
        if (!d.last_check_at) {
            el.className = 'small text-muted mt-1';
            el.textContent = '还没有测活记录：点「测当前模型」会记下时间、模型和失败原因。';
            return;
        }
        const ok = d.last_check_ok === true;
        const at = petAiFmtAt(new Date(d.last_check_at).getTime());
        let text = ok ? '上次可用' : '上次不可用';
        if (at) text += '（' + at + '）';
        if (d.last_check_model) text += '：' + d.last_check_model;
        if (d.last_check_ms != null) text += ' · ' + d.last_check_ms + 'ms';
        if (!ok && d.last_check_message) text += ' · ' + d.last_check_message;
        el.textContent = text;
        el.className = 'small mt-1 ' + (ok ? 'text-success' : 'text-warning');
    }
    function petAiRefreshStatus() {
        fetch(PET_AI_URLS.config).then(r => r.json()).then(function(d) {
            petAiRenderDiag(d);
            petAiMarkStatus(d.configured, d.model, d.base_url);
        }).catch(function() {});
    }
    // 最近调用:任务 → 人话。格式修复单列出来,别和原始任务混成一条
    const PET_AI_TASK_LABELS = {site: '找网站', classify: '分类', pet: '桌宠聊天',
                                whisper: '碎碎念', chat: '对话', repair: '格式修复'};
    function petAiTaskLabel(task) {
        const raw = String(task || 'chat');
        const fixed = /_fix$/.test(raw);
        const key = raw.replace(/_fix$/, '');
        return (PET_AI_TASK_LABELS[key] || key) + (fixed ? ' · 修复' : '');
    }
    function petAiRenderLogs(logs) {
        const box = document.getElementById('petAiLogList');
        if (!box) return;
        box.textContent = '';
        if (!logs || !logs.length) {
            box.className = 'nav-ai-log-list mt-2 small text-muted';
            box.textContent = '还没有调用记录。用过找网站 / 分类 / 桌宠聊天之后，这里会留下最近 20 条。';
            return;
        }
        box.className = 'nav-ai-log-list mt-2';
        logs.forEach(function(it) {
            const row = document.createElement('div');
            row.className = 'nav-ai-log-row';
            const mark = document.createElement('span');
            mark.className = it.ok ? 'ok' : 'bad';
            mark.textContent = it.ok ? '✓' : '✗';
            const task = document.createElement('span');
            task.className = 'text-muted';
            task.textContent = petAiTaskLabel(it.task);
            const msg = document.createElement('span');
            msg.className = 'msg';
            const parts = [];
            if (it.model) parts.push(it.model);
            if (it.elapsed_ms != null) parts.push(it.elapsed_ms + 'ms');
            if (it.http_status) parts.push('HTTP ' + it.http_status);
            if (!it.ok && it.message) parts.push(it.message);
            const text = parts.join(' · ');
            msg.textContent = text;
            msg.title = text;
            const at = document.createElement('span');
            at.className = 'ms-auto text-muted';
            at.textContent = petAiFmtAt(new Date(it.at).getTime());
            row.appendChild(mark); row.appendChild(task); row.appendChild(msg); row.appendChild(at);
            box.appendChild(row);
        });
    }
    function petAiLoadLogs() {
        if (!PET_AI_URLS.logs) return;
        fetch(PET_AI_URLS.logs).then(r => r.json()).then(function(d) {
            petAiRenderLogs((d && d.logs) || []);
        }).catch(function() {
            const box = document.getElementById('petAiLogList');
            if (box) {
                box.className = 'nav-ai-log-list mt-2 small text-muted';
                box.textContent = '调用记录取不到';
            }
        });
    }
    // 接口地址一改就自动探测模型(服务端代取,浏览器直连本机网关会被 CORS/混合内容拦)
    const petAiModelsSeen = {};      // 已成功探测过的 base_url,避免每次失焦都再打一次
    let petAiModelList = [];         // 最近一次检测到的模型
    const petAiModelStatus = {};     // model id → {pending|ok|message|ms}
    let petAiOnlyUsable = false;     // 测试完成后只看 ✅ 的模型(用户要求"下拉已替换为可用模型")
    const PET_AI_TEST_LS = 'navPetAiModelTestV1';   // 最近一次「测试全部」的结果,按接口地址缓存
    function petAiBaseNow() {
        const el = document.getElementById('petAiBase');
        return ((el && el.value) || '').trim().replace(/\/+$/, '');
    }
    function petAiFmtTime(ts) {
        const d = new Date(ts || Date.now());
        const p = function(n) { return n < 10 ? '0' + n : String(n); };
        return (d.getMonth() + 1) + '-' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }
    // 2026-11-19:诊断行/调用记录用的是 petAiFmtAt,但这个函数从来没定义过 ——
    // 保存成功后 petAiRenderDiag() 抛 ReferenceError,被外层 .catch 接住,
    // 于是「模型明明可用、配置也写进去了」却显示「测试或保存请求失败,未保存」。
    // 时间解不出来就返回空串,不显示 NaN。
    function petAiFmtAt(ts) {
        return (typeof ts === 'number' && isFinite(ts)) ? petAiFmtTime(ts) : '';
    }
    function petAiTestLsKey(base) { return PET_AI_TEST_LS + '|' + base; }
    function petAiReadTestCache(base) {
        try {
            const raw = localStorage.getItem(petAiTestLsKey(base));
            if (!raw) return null;
            const o = JSON.parse(raw);
            if (!o || o.base !== base || !o.results || typeof o.results !== 'object') return null;
            return o;
        } catch (e) { return null; }
    }
    function petAiWriteTestCache(complete) {
        try {
            const base = petAiBaseNow();
            if (!base) return;
            const results = {};
            let ok = 0, done = 0;
            petAiModelList.forEach(function(m) {
                const st = petAiModelStatus[m.id];
                if (st && !st.pending) {
                    results[m.id] = {ok: !!st.ok, message: st.message || '', ms: st.ms || 0};
                    done += 1;
                    if (st.ok) ok += 1;
                }
            });
            localStorage.setItem(petAiTestLsKey(base), JSON.stringify({
                base: base, at: Date.now(), complete: !!complete, total: petAiModelList.length,
                tested: done, ok: ok, filtered: petAiOnlyUsable, results: results
            }));
        } catch (e) { /* localStorage 满了/被禁用也不影响测试本身 */ }
    }
    function petAiModelsHint(text, cls) {
        const el = document.getElementById('petAiModelsHint');
        if (!el) return;
        el.textContent = text;
        el.className = 'small ' + (cls || 'text-muted');
    }
    function petAiBadgeSet(ok, total, testing) {
        const b = document.getElementById('petAiTestBadge');
        if (!b) return;
        b.classList.remove('d-none', 'bg-success', 'bg-danger', 'bg-secondary');
        if (testing) { b.textContent = '测试中…'; b.classList.add('bg-secondary'); return; }
        b.textContent = '可用 ' + ok + '/' + total;
        b.classList.add(ok > 0 ? 'bg-success' : 'bg-danger');
    }
    // 2026-11-19(用户要求):分类模型/桌宠模型原来只能手打模型名。改成
    // 「输入框 + ▾ 下拉」,下拉里默认项只留一个「默认（跟随主模型）」,
    // 模型列表里叫 default / 默认 的条目直接剔掉 —— 它们就是默认本身,
    // 再列一遍等于让用户选两次同一个东西。手打自定义模型名仍然保留。
    function petAiIsDefaultModelId(id) {
        return /^(default|默认)$/i.test(String(id || '').trim());
    }
    function petAiCleanModelList(models) {
        const seen = Object.create(null);
        return (models || []).filter(function(m) {
            if (!m || !m.id) return false;
            const id = String(m.id).trim();
            if (!id || petAiIsDefaultModelId(id) || seen[id]) return false;
            seen[id] = 1;
            return true;
        });
    }
    function petAiTaskModelRows() {
        return [
            {input: 'petAiModelClassify', btn: 'petAiClassifyModelBtn', menu: 'petAiClassifyModelMenu'},
            {input: 'petAiModelPet', btn: 'petAiModelPetBtn', menu: 'petAiModelPetMenu'}
        ];
    }
    function petAiRenderTaskModelMenus() {
        petAiTaskModelRows().forEach(function(row) {
            const input = document.getElementById(row.input);
            const menu = document.getElementById(row.menu);
            const btn = document.getElementById(row.btn);
            if (!input || !menu) return;
            if (btn && !btn.dataset.modelMenuBound) {
                btn.dataset.modelMenuBound = '1';
                btn.addEventListener('click', function() { petAiRenderTaskModelMenus(); });
            }
            if (!menu.dataset.modelMenuBound) {
                menu.dataset.modelMenuBound = '1';
                menu.addEventListener('click', function(ev) {
                    const item = ev.target && ev.target.closest ? ev.target.closest('[data-model]') : null;
                    if (!item || item.disabled) return;
                    input.value = item.getAttribute('data-model') || '';
                    if (window.bootstrap && bootstrap.Dropdown && btn) {
                        bootstrap.Dropdown.getOrCreateInstance(btn).hide();
                    }
                });
            }
            const cur = (input.value || '').trim();
            menu.textContent = '';
            function addItem(value, label, selected, mark, title) {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'dropdown-item small d-flex align-items-center gap-2';
                item.setAttribute('data-model', value);
                const name = document.createElement('span');
                name.textContent = label;
                name.style.cssText = 'min-width:0;flex:1 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
                item.title = title || label;
                item.appendChild(name);
                const tail = document.createElement('span');
                tail.className = 'ms-auto small';
                tail.textContent = selected ? '✓' : (mark || '');
                item.appendChild(tail);
                menu.appendChild(item);
                return item;
            }
            addItem('', '默认（跟随主模型）', !cur, '', '留空 = 跟随上面的默认模型');
            if (!petAiModelList.length) {
                const hint = document.createElement('button');
                hint.type = 'button';
                hint.className = 'dropdown-item small text-muted';
                hint.disabled = true;
                hint.textContent = '（还没有检测到模型，可直接输入模型名）';
                menu.appendChild(hint);
                return;
            }
            petAiModelList.forEach(function(m) {
                const st = petAiModelStatus[m.id];
                const label = m.id + ((m.name && m.name !== m.id) ? (' — ' + m.name) : '');
                const mark = st ? (st.pending ? '⏳' : (st.ok ? '✅' : '❌')) : '';
                const title = st && st.message ? (label + ' · ' + st.message + (st.ms ? (' · ' + st.ms + 'ms') : '')) : label;
                addItem(m.id, label, m.id === cur, mark, title);
            });
        });
    }
    function petAiPrefetchModels(base) {
        const b = String(base || '').trim().replace(/\/+$/, '');
        if (!b) { petAiRenderTaskModelMenus(); return; }
        if (petAiModelsSeen[b]) { petAiRenderTaskModelMenus(); return; }
        petAiModelsSeen[b] = true;
        petAiPost(PET_AI_URLS.models, {base_url: b}).then(function(d) {
            if (!d || d.status !== 'ok') {
                petAiModelsSeen[b] = false;
                petAiRenderTaskModelMenus();
                return;
            }
            petAiFillModels(d.models || []);
        }).catch(function() {
            petAiModelsSeen[b] = false;
            petAiRenderTaskModelMenus();
        });
    }
    function petAiRenderModels() {
        const menu = document.getElementById('petAiModelMenu');
        if (!menu) return;
        menu.textContent = '';
        const shown = petAiOnlyUsable
            ? petAiModelList.filter(function(m) { return petAiModelStatus[m.id] && petAiModelStatus[m.id].ok; })
            : petAiModelList;
        if (!shown.length) {
            const empty = document.createElement('button');
            empty.type = 'button';
            empty.className = 'dropdown-item small text-muted';
            empty.disabled = true;
            empty.textContent = petAiOnlyUsable
                ? '（这次没有可用模型，点「检测模型」恢复全部）'
                : '（没有检测到模型，先点「检测模型」）';
            menu.appendChild(empty);
            return;
        }
        shown.forEach(function(m) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'dropdown-item small d-flex align-items-center gap-2';
            item.dataset.model = m.id;
            const name = document.createElement('span');
            name.textContent = m.id + ((m.name && m.name !== m.id) ? (' — ' + m.name) : '');
            name.style.cssText = 'min-width:0;flex:1 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
            item.title = m.id;   // 名字被省略号截断时,悬停仍能看到完整模型名
            const mark = document.createElement('span');
            mark.className = 'ms-auto small';
            const st = petAiModelStatus[m.id];
            mark.textContent = st ? (st.pending ? '⏳' : (st.ok ? '✅' : '❌')) : '';
            if (st && st.message) mark.title = st.message + (st.ms ? (' · ' + st.ms + 'ms') : '');
            item.appendChild(name);
            item.appendChild(mark);
            menu.appendChild(item);
        });
        if (petAiOnlyUsable) {   // 别把没能用的模型永久藏死:留一个恢复入口
            const all = document.createElement('button');
            all.type = 'button';
            all.className = 'dropdown-item small text-muted';
            all.dataset.action = 'all';
            all.textContent = '显示全部 ' + petAiModelList.length + ' 个';
            menu.appendChild(all);
        }
    }
    function petAiFillModels(models) {
        petAiModelList = petAiCleanModelList(models);
        Object.keys(petAiModelStatus).forEach(function(k) { delete petAiModelStatus[k]; });
        const tb = document.getElementById('petAiTestModelsBtn');
        let ok = 0, done = 0;
        const cache = petAiReadTestCache(petAiBaseNow());
        if (cache) {
            petAiModelList.forEach(function(m) {
                const st = cache.results[m.id];
                if (st) {
                    petAiModelStatus[m.id] = {ok: !!st.ok, message: st.message || '', ms: st.ms || 0};
                    done += 1;
                    if (st.ok) ok += 1;
                }
            });
        }
        const total = petAiModelList.length;
        const full = !!cache && total > 0 && done === total;
        petAiOnlyUsable = !!(full && cache.filtered && ok > 0);
        if (tb) {
            tb.classList.remove('btn-success');
            tb.classList.add('btn-outline-secondary');
            if (full) {
                tb.textContent = '重测全部';
                tb.title = '上次测试于 ' + petAiFmtTime(cache.at) + '，点一下可重测';
                petAiBadgeSet(ok, total, false);
            } else {
                tb.textContent = '测试全部';
                tb.title = '逐个真发一次最小请求，标出哪些模型能用';
                const badge = document.getElementById('petAiTestBadge');
                if (badge) badge.classList.add('d-none');
            }
        }
        petAiRenderModels();
        petAiRenderTaskModelMenus();
        if (full) {
            let msg = '已读取上次测试：可用 ' + ok + '/' + total + '（' + petAiFmtTime(cache.at) + '，已存本机，无需重测）';
            if (petAiOnlyUsable) msg += '，下拉只显示可用模型';
            petAiModelsHint(msg, ok ? 'text-success' : 'text-danger');
        } else if (cache && done) {
            petAiModelsHint('上次测试可用 ' + ok + '/' + total + '（另有 ' + (total - done) + ' 个模型未测）',
                'text-muted');
        }
        return full ? cache : null;
    }
    // 保存前必须先探活(2026-11-18 用户要求):不可用就禁止落库,别让「已保存」变成假绿。
    // 所有写配置的入口(保存按钮、选模型即保存)都走这里,不允许绕过。
    let petAiSaveSeq = 0;
    function petAiTestThenSave(payload, opts) {
        opts = opts || {};
        const seq = ++petAiSaveSeq;
        const hint = document.getElementById('petAiSaveHint');
        function show(text, cls) {
            if (hint) { hint.textContent = text; hint.className = 'small mt-1 ' + (cls || 'text-muted'); }
        }
        // 批量测模型还在跑时不许保存(2026-11-19):31 个模型是串行探活,同一个接口会排队,
        // 这时候当场复测几乎必然超时 —— 用户看到的就是「明明可用,点保存却失败」。
        if (petAiTesting) {
            show('✗ 正在批量测试模型，等它跑完再点保存（同一个接口会排队）', 'text-warning');
            petAiModelsHint('批量测试还没结束，先别保存', 'text-warning');
            return Promise.resolve(null);
        }
        show(opts.testingText || '正在测试接口，通过后才保存…', 'text-muted');
        petAiModelsHint('正在当场复测当前模型：' + payload.model, 'text-muted');
        return petAiPost(PET_AI_URLS.modelTest, {
            base_url: payload.base_url, api_key: payload.api_key, model: payload.model
        }).then(function(t) {
            if (seq !== petAiSaveSeq) return null;   // 又点了别的模型/保存,这次结果作废
            if (!t || t.status !== 'ok' || !t.ok) {
                show('✗ 当场复测没通过，未保存：' + ((t && t.message) || '测试失败'), 'text-danger');
                petAiModelsHint('当前模型复测失败：' + payload.model +
                    '（上面「可用 N/M」是上次批量测试的旧结果，可点「重测全部」刷新）', 'text-warning');
                if (opts.onFail) opts.onFail();
                return null;
            }
            if (opts.onPass) opts.onPass();
            return petAiPost(opts.url || PET_AI_URLS.config, payload).then(function(d) {
                if (seq !== petAiSaveSeq) return null;
                petAiMarkStatus(d.configured, payload.model, payload.base_url);
                show('✓ 已保存并通过测试（' + (t.latency_ms || 0) + 'ms）', 'text-success');
                petAiModelsHint('当前模型已通过测试：' + payload.model, 'text-success');
                petAiRenderDiag(d);
                petAiLoadLogs();
                if (petAiModelStatus[payload.model] !== undefined) {
                    petAiModelStatus[payload.model] = {ok: true, ms: t.latency_ms,
                                                       message: '保存时测试通过'};
                    petAiRenderModels();
                }
                if (opts.onSaved) opts.onSaved(d, t);
                return d;
            });
        }).catch(function(err) {
            if (seq !== petAiSaveSeq) return;
            const why = (err && err.message) ? err.message : '网络或服务器错误';
            show('✗ 请求失败，未保存：' + why, 'text-danger');
            petAiModelsHint('当场复测没通过（上面「可用 N/M」是上次批量测试的旧结果）：' + payload.model,
                'text-warning');
            if (opts.onFail) opts.onFail();
        });
    }
    // 换了模型只改输入框、不落库,后端还会拿旧模型去跑「找网站/分类」。
    // 选中即「先测后存」:测不通就不保存,旧配置保持可用。
    function petAiPersistCore() {
        const baseEl = document.getElementById('petAiBase');
        const keyEl = document.getElementById('petAiKey');
        const modelEl = document.getElementById('petAiModel');
        const base = ((baseEl && baseEl.value) || '').trim();
        const model = ((modelEl && modelEl.value) || '').trim();
        if (!base || !model) return;
        petAiTestThenSave({
            base_url: base,
            api_key: (keyEl && keyEl.value) || '',
            model: model
        }, {
            url: PET_AI_URLS.aiConfig,
            testingText: '正在测试所选模型，通过后自动保存…'
        });
    }
    let petAiTesting = false;
    function petAiTestAll() {
        const btn = document.getElementById('petAiTestModelsBtn');
        const baseEl = document.getElementById('petAiBase');
        const base = ((baseEl && baseEl.value) || '').trim().replace(/\/+$/, '');
        if (!/^https?:\/\//i.test(base)) {
            petAiModelsHint('先填接口地址（http:// 或 https://）', 'text-danger');
            return;
        }
        if (!petAiModelList.length) {
            petAiModelsHint('先点「检测模型」拿到模型列表', 'text-danger');
            return;
        }
        if (petAiTesting) return;
        petAiTesting = true;
        if (btn) { btn.disabled = true; btn.textContent = '测试中…'; }
        petAiBadgeSet(0, 0, true);
        petAiOnlyUsable = false;   // 测试过程中先显示全量,边测边看
        Object.keys(petAiModelStatus).forEach(function(k) { delete petAiModelStatus[k]; });
        petAiRenderModels();
        let i = 0, okCount = 0;
        const key = (document.getElementById('petAiKey') || {}).value || '';
        function next() {
            if (i >= petAiModelList.length) {
                petAiTesting = false;
                const total = petAiModelList.length;
                petAiOnlyUsable = okCount > 0;
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = '重测全部';
                }
                petAiBadgeSet(okCount, total, false);
                petAiRenderModels();
                petAiWriteTestCache(true);   // 存 localStorage:下次打开直接恢复,不用重测
                const cur = (document.getElementById('petAiModel') || {}).value || '';
                const curSt = petAiModelStatus[cur];
                let msg = '测试完成：可用 ' + okCount + '/' + total + '（结果已存本机，下次无需重测）';
                if (petAiOnlyUsable) msg += '，下拉已只显示可用模型（点「检测模型」恢复全部）';
                if (curSt && curSt.ok === false) msg += '；当前填的 ' + cur + ' 不可用，请从下拉改选';
                petAiModelsHint(msg, (curSt && curSt.ok === false) ? 'text-warning' : (okCount ? 'text-success' : 'text-danger'));
                if (typeof showToast === 'function') {
                    showToast(petAiOnlyUsable
                        ? ('测试完成：可用 ' + okCount + '/' + total + '，下拉已替换为可用模型')
                        : ('测试完成：可用 ' + okCount + '/' + total + '，没有可用模型'));
                }
                return;
            }
            const m = petAiModelList[i];
            i += 1;
            petAiModelStatus[m.id] = {pending: true};
            petAiRenderModels();
            petAiModelsHint('测试中 ' + i + '/' + petAiModelList.length + '：' + m.id, 'text-muted');
            petAiPost(PET_AI_URLS.modelTest, {base_url: base, api_key: key, model: m.id})
                .then(function(d) {
                    if (d && d.status === 'ok' && d.ok) {
                        petAiModelStatus[m.id] = {ok: true, ms: d.latency_ms, message: d.message || '可用'};
                        okCount += 1;
                    } else {
                        petAiModelStatus[m.id] = {ok: false, ms: d && d.latency_ms,
                                                  message: (d && d.message) || '不可用'};
                    }
                }).catch(function() {
                    petAiModelStatus[m.id] = {ok: false, message: '请求失败'};
                }).then(function() {
                    petAiWriteTestCache(false);   // 每测完一个就落盘,中途关页面也不白测
                    next();
                });
        }
        next();
    }
    function petAiDetectModels(force) {
        const baseEl = document.getElementById('petAiBase');
        const modelEl = document.getElementById('petAiModel');
        const btn = document.getElementById('petAiModelsBtn');
        if (!baseEl || !modelEl || !PET_AI_URLS.models) return;
        const base = (baseEl.value || '').trim().replace(/\/+$/, '');
        if (!/^https?:\/\//i.test(base)) {
            petAiModelsHint('接口地址要以 http:// 或 https:// 开头', 'text-danger');
            return;
        }
        if (!force && petAiModelsSeen[base]) return;
        petAiModelsSeen[base] = true;
        petAiModelsHint('检测中…', 'text-muted');
        if (btn) btn.disabled = true;
        petAiPost(PET_AI_URLS.models, {
            base_url: base,
            api_key: (document.getElementById('petAiKey') || {}).value || ''
        }).then(function(d) {
            if (btn) btn.disabled = false;
            if (!d || d.status !== 'ok') {
                petAiModelsSeen[base] = false;          // 失败允许下次重试
                petAiModelsHint((d && d.message) || '检测失败', 'text-danger');
                return;
            }
            const models = d.models || [];
            const restored = petAiFillModels(models);
            if (!modelEl.value.trim() && models.length) {
                const auto = models.filter(function(m) { return /^auto\//.test(m.id); })[0];
                modelEl.value = (auto || models[0]).id;   // 空着才填:有路由组优先路由组
            }
            if (!restored) {
                petAiModelsHint(models.length
                    ? ('检测到 ' + models.length + ' 个模型，点 ▾ 可看全部')
                    : '接口没返回模型，手动填模型名即可', models.length ? 'text-success' : 'text-muted');
            }
        }).catch(function() {
            if (btn) btn.disabled = false;
            petAiModelsSeen[base] = false;
            petAiModelsHint('检测失败，检查接口是否在运行', 'text-danger');
        });
    }
    window.petAiOpen = function() {
        const m = document.getElementById('petAiModal');
        bootstrap.Modal.getOrCreateInstance(m).show();
        fetch(PET_AI_URLS.config).then(r => r.json()).then(function(d) {
            petAiMarkStatus(d.configured, d.model, d.base_url);
            document.getElementById('petAiBase').value = d.base_url || '';
            document.getElementById('petAiModel').value = d.model || '';
            const mc = document.getElementById('petAiModelClassify');
            if (mc) mc.value = d.model_classify || '';
            const mp = document.getElementById('petAiModelPet');
            if (mp) mp.value = d.model_pet || '';
            petAiRenderTaskModelMenus();
            document.getElementById('petAiPersona').value = d.persona || '';
            document.getElementById('petAiRounds').value = (d.memory_rounds == null ? 5 : d.memory_rounds);
            document.getElementById('petAiWhisperOn').checked = localStorage.getItem('navPetAiWhisper') === '1';
            petAiRenderDiag(d);
            petAiLoadLogs();
            if (d.base_url) petAiDetectModels(false);   // 打开就把列表备好,点 ▾ 立刻能选
        });
    };
    (function() {
        const saveBtn = document.getElementById('petAiSaveBtn');
        if (!saveBtn) return;
        saveBtn.addEventListener('click', function() {
            const oldText = saveBtn.textContent;
            const hint = document.getElementById('petAiSaveHint');
            const baseEl = document.getElementById('petAiBase');
            const keyEl = document.getElementById('petAiKey');
            const modelEl = document.getElementById('petAiModel');
            const base = ((baseEl && baseEl.value) || '').trim();
            const model = ((modelEl && modelEl.value) || '').trim();
            function resetBtn() { saveBtn.disabled = false; saveBtn.textContent = oldText || '保存'; }
            function showHint(text, cls) {
                if (hint) { hint.textContent = text; hint.className = 'small mt-1 ' + (cls || 'text-muted'); }
            }
            if (!/^https?:\/\//i.test(base)) {
                showHint('✗ 先填正确的接口地址（http:// 或 https://）', 'text-danger');
                return;
            }
            if (!model) {
                showHint('✗ 先填模型名（可从模型框右侧 ▾ 选）', 'text-danger');
                return;
            }
            saveBtn.disabled = true;
            saveBtn.textContent = '测试中…';
            petAiTestThenSave({
                base_url: base,
                api_key: (keyEl && keyEl.value) || '',
                model: model,
                model_classify: ((document.getElementById('petAiModelClassify') || {}).value || '').trim(),
                model_pet: ((document.getElementById('petAiModelPet') || {}).value || '').trim(),
                persona: document.getElementById('petAiPersona').value,
                memory_rounds: parseInt(document.getElementById('petAiRounds').value, 10) || 0
            }, {
                url: PET_AI_URLS.config,
                testingText: '正在测试接口，通过后才保存…',
                onPass: function() { saveBtn.textContent = '保存中…'; },
                onFail: resetBtn,
                onSaved: function(d, t) {
                    resetBtn();
                    if (window.showToast) showToast('AI 接口已接上（测试通过），找网站和桌宠都能用了');
                }
            });
        });
        const clearBtn = document.getElementById('petAiClearMemBtn');
        if (clearBtn) {
            let clearArmed = false, clearTimer = 0;
            const clearReset = function() {
                clearArmed = false;
                clearBtn.textContent = '清除记忆（不可恢复）';
                clearBtn.classList.remove('fw-bold');
            };
            clearBtn.addEventListener('click', function() {
                if (!clearArmed) {
                    clearArmed = true;
                    clearBtn.textContent = '确认清除？再点一次';
                    clearBtn.classList.add('text-danger', 'fw-bold');
                    clearTimer = setTimeout(clearReset, 4000);
                    return;
                }
                clearTimeout(clearTimer);
                clearReset();
                petAiPost(PET_AI_URLS.config, {clear_memory: true}).then(function() {
                    if (window.showToast) showToast('小鲸鱼忘掉之前的对话啦');
                });
            });
        }
        const testCurBtn = document.getElementById('petAiTestCurrentBtn');
        if (testCurBtn) testCurBtn.addEventListener('click', function() {
            const base = ((document.getElementById('petAiBase') || {}).value || '').trim();
            const model = ((document.getElementById('petAiModel') || {}).value || '').trim();
            const key = ((document.getElementById('petAiKey') || {}).value || '');
            if (!/^https?:\/\//i.test(base) || !model) {
                petAiModelsHint('先填接口地址和模型名再测', 'text-warning');
                return;
            }
            const old = testCurBtn.textContent;
            testCurBtn.disabled = true;
            testCurBtn.textContent = '测试中…';
            petAiModelsHint('正在测试当前模型：' + model, 'text-muted');
            petAiPost(PET_AI_URLS.modelTest, {base_url: base, api_key: key, model: model}).then(function(d) {
                testCurBtn.disabled = false;
                testCurBtn.textContent = old || '测当前模型';
                if (d && d.status === 'ok' && d.ok) {
                    petAiModelsHint('✓ 当前模型可用（' + (d.latency_ms || 0) + 'ms）：' + model, 'text-success');
                } else {
                    petAiModelsHint('✗ 当前模型不可用：' + ((d && d.message) || '测试失败'), 'text-warning');
                }
                petAiRefreshStatus();   // 探活结果已落库,顺手把「上次可用/不可用」那行刷新
                petAiLoadLogs();
            }).catch(function() {
                testCurBtn.disabled = false;
                testCurBtn.textContent = old || '测当前模型';
                petAiModelsHint('✗ 当前模型测试请求失败', 'text-warning');
            });
        });
        document.getElementById('petAiWhisperOn').addEventListener('change', function() {
            localStorage.setItem('navPetAiWhisper', this.checked ? '1' : '0');
        });
        document.getElementById('petAiBalanceBtn').addEventListener('click', function() { petAiBalance(); });
        const logBtn = document.getElementById('petAiLogBtn');
        if (logBtn) logBtn.addEventListener('click', petAiLoadLogs);
        const baseEl = document.getElementById('petAiBase');
        if (baseEl) baseEl.addEventListener('change', function() { petAiDetectModels(false); });
        const modelsBtn = document.getElementById('petAiModelsBtn');
        if (modelsBtn) modelsBtn.addEventListener('click', function() { petAiDetectModels(true); });
        const testModelsBtn = document.getElementById('petAiTestModelsBtn');
        if (testModelsBtn) testModelsBtn.addEventListener('click', function() { petAiTestAll(); });
        const modelMenu = document.getElementById('petAiModelMenu');
        if (modelMenu) modelMenu.addEventListener('click', function(ev) {
            const item = ev.target.closest('.dropdown-item');
            if (!item) return;
            if (item.dataset.action === 'all') {
                petAiOnlyUsable = false;
                petAiRenderModels();
                // 用户主动「显示全部」= 下次打开也别再只显示可用项
                const full = petAiModelList.length && petAiModelList.every(function(m) {
                    const st = petAiModelStatus[m.id];
                    return st && !st.pending;
                });
                petAiWriteTestCache(full);
                return;
            }
            if (!item.dataset.model) return;
            document.getElementById('petAiModel').value = item.dataset.model;
            petAiPersistCore();   // 选中即落库,别让「找网站/分类」还在用旧模型
        });
        const modelEl = document.getElementById('petAiModel');
        if (modelEl) modelEl.addEventListener('change', function() { petAiPersistCore(); });
    })();
    // 聊天输入气泡(dsh-pet shared/chat 思路:单行输入贴着宠物,Enter 发送,Esc/点外关闭)
    function petAiQuickOpen() {
        if (window.NAV_GUEST_MODE && !(window.navGuestAi && window.navGuestAi.configured())) {
            petSay('先填本机接口和模型,我才能聊天~ 点「AI 接口与对话」', 3600);
            if (window.openGuestLocalAiPanel) window.openGuestLocalAiPanel();
            return;
        }
        if (!window.NAV_GUEST_MODE && petAiReady === false) {
            petSay('我的大脑还没接上呢,点顶栏「AI 接口」配置一下~', 3400);
            petBeep('pick');
            return;
        }
        let box = document.getElementById('navPetChatBox');
        const pet = document.getElementById('navPet');
        if (!box) {
            box = document.createElement('div');
            box.id = 'navPetChatBox';
            box.style.cssText = 'position:fixed;z-index:1040;display:none;gap:6px;align-items:center;' +
                'background:var(--bs-body-bg);border:1px solid var(--bs-border-color);border-radius:12px;' +
                'padding:6px 8px;box-shadow:0 6px 24px rgba(0,0,0,.18);max-width:380px';
            const input = document.createElement('input');
            input.id = 'navPetChatInput';
            input.maxLength = 2000;
            input.placeholder = '立即回复：跟小鲸鱼说点什么…（Enter 发送）';
            input.className = 'form-control form-control-sm';
            input.style.border = 'none';
            input.style.boxShadow = 'none';
            input.style.background = 'transparent';
            input.style.color = 'var(--bs-body-color)';
            const send = document.createElement('button');
            send.type = 'button';
            send.textContent = '发送';
            send.className = 'btn btn-sm btn-success';
            const expand = document.createElement('button');
            expand.type = 'button';
            expand.id = 'navPetChatExpand';
            expand.textContent = '聊天窗口';
            expand.title = '打开微信式聊天窗口';
            expand.className = 'btn btn-sm btn-outline-secondary';
            input.style.flex = '1 1 100px';
            input.style.minWidth = '0';
            box.appendChild(input); box.appendChild(send); box.appendChild(expand);
            document.body.appendChild(box);
            box.addEventListener('keydown', function(ev) {
                if (ev.key === 'Enter') { ev.preventDefault(); petAiChatSend(); }
                else if (ev.key === 'Escape') { petAiChatClose(); }
            });
            box.addEventListener('click', function(ev) { ev.stopPropagation(); });
            send.addEventListener('click', petAiChatSend);
            expand.addEventListener('click', function(ev) {
                ev.stopPropagation();
                petAiChatClose();
                petChatWindowOpen();
            });
        }
        const pr = pet ? pet.getBoundingClientRect() : {left: 40, top: window.innerHeight * .6, width: 100, height: 80};
        box.style.display = 'flex';
        box.style.left = Math.max(8, Math.min(pr.left - 60, window.innerWidth - 400)) + 'px';
        box.style.top = Math.max(56, pr.top - 52) + 'px';
        const inp = document.getElementById('navPetChatInput');
        inp.value = '';
        setTimeout(function() { inp.focus(); }, 50);
    }
    window.petAiQuickOpen = petAiQuickOpen;
    window.petAiChatClose = function() {
        const box = document.getElementById('navPetChatBox');
        if (box) box.style.display = 'none';
    };
    document.addEventListener('click', function(ev) {
        const box = document.getElementById('navPetChatBox');
        if (box && box.style.display !== 'none' && !box.contains(ev.target)) petAiChatClose();
    });
    function petAiChatSend() {
        const inp = document.getElementById('navPetChatInput');
        const text = (inp && inp.value || '').trim();
        if (!text || petAiBusy) return;
        // 命令表情:以 / 开头的指令直接触发动作,不发网络请求(蒸馏 dsh-pet command-faces)
        if (text.charAt(0) === '/' && petCommand(text)) {
            inp.value = '';
            petAiChatClose();
            return;
        }
        petAiBusy = true;
        inp.value = '';
        petAiChatClose();
        petPlayByName(PET_POOL.work[0]);       // 思考冒泡
        petSay('让我想想…', 8000);
        const quickChatReq = (window.NAV_GUEST_MODE && window.navGuestAi)
            ? window.navGuestAi.chat(text, petChatHistory)
            : petAiPost(PET_AI_URLS.chat, {text: text});
        quickChatReq.then(function(d) {
            petAiBusy = false;
            if (d.status === 'ok') {
                petAiReady = true;
                window.navPetState('happy');
                petSay(d.reply, Math.max(4000, Math.min(12000, d.reply.length * 120)));
                if (d.meme) petMeme(d.meme);
                petBeep('greet');
            } else {
                if (d.configured === false) petAiReady = false;
                petSay(d.message || '我走神了,再说一遍好不好', 4200);
            }
        }).catch(function() {
            petAiBusy = false;
            petSay('网络好像不太顺,等下再聊', 3200);
        });
    }
    // ===== 微信式聊天窗口(2026-11-18):和快捷气泡并存 =====
    const PET_CHAT_LS = 'navPetChatHistoryV1', PET_CHAT_MODE_LS = 'navPetChatMode';
    const PET_CHAT_POS_LS = 'navPetChatPosV2', PET_CHAT_QUICK_DEF = [
        ['random', '🎲 随机站'], ['search', '🔎 搜站'], ['stats', '📊 站点统计'],
        ['ai-find', '🤖 AI 找站'], ['ai-classify', '🏷 AI 分类']
    ];
    let petChatHistory = (function() {
        try {
            const a = JSON.parse(localStorage.getItem(PET_CHAT_LS) || '[]');
            return Array.isArray(a) ? a.slice(-40) : [];
        } catch (e) { return []; }
    })();
    let petChatPendingAction = '', petChatWinBusy = false;
    function petChatSaveHistory() {
        try { localStorage.setItem(PET_CHAT_LS, JSON.stringify(petChatHistory.slice(-40))); } catch (e) {}
    }
    function petChatScroll() {
        const box = document.getElementById('navPetChatMsgs');
        if (box) box.scrollTop = box.scrollHeight;
    }
    function petChatTyping(show) {
        const box = document.getElementById('navPetChatMsgs');
        if (!box) return;
        const old = document.getElementById('navPetChatTyping');
        if (old) old.remove();
        if (show) {
            const t = document.createElement('div');
            t.id = 'navPetChatTyping';
            t.className = 'nav-pet-msg system';
            t.textContent = '小鲸鱼正在输入…';
            box.appendChild(t);
            petChatScroll();
        }
    }
    function petChatRender() {
        const box = document.getElementById('navPetChatMsgs');
        if (!box) return;
        box.textContent = '';
        if (!petChatHistory.length) {
            const empty = document.createElement('div');
            empty.className = 'nav-pet-msg system';
            empty.textContent = '点下面的快捷操作，或直接问我在找什么站。';
            box.appendChild(empty);
            return;
        }
        // 两个显示开关在宠物设置「💬 聊天」页签里,默认:思考显示、复制按钮不显示(2026-11-19)
        const showReasoning = localStorage.getItem('navPetChatReasoning') !== '0';
        const showCopy = localStorage.getItem('navPetChatCopy') === '1';
        petChatHistory.forEach(function(m) {
            const div = document.createElement('div');
            div.className = 'nav-pet-msg ' + (m.role === 'user' ? 'user' : (m.role === 'system' ? 'system' : 'pet'));
            div.textContent = m.text || '';
            if (m.links && m.links.length) {
                const wrap = document.createElement('div');
                wrap.className = 'nav-pet-msg-links';
                m.links.forEach(function(l) {
                    if (!/^https?:\/\//i.test(l.url || '')) return;
                    const a = document.createElement('a');
                    a.href = l.url;
                    a.target = '_blank';
                    a.rel = 'noopener noreferrer';
                    a.textContent = '↗ ' + (l.name || l.url);
                    wrap.appendChild(a);
                });
                if (wrap.children.length) div.appendChild(wrap);
            }
            if (showReasoning) {
                const think = petChatThinkBlock(m.reasoning);
                if (think) div.appendChild(think);
            }
            const metaLine = petChatMetaLine(m);
            if (metaLine) div.appendChild(metaLine);
            if (m.role === 'pet' && showCopy) {
                const actions = document.createElement('div');
                actions.className = 'nav-pet-msg-actions';
                if (m.text) {
                    const copyReply = document.createElement('button');
                    copyReply.type = 'button';
                    copyReply.className = 'nav-pet-msg-copy';
                    copyReply.textContent = '复制回复';
                    copyReply.addEventListener('click', function() {
                        petCopyText(m.text).then(function(ok) {
                            copyReply.textContent = ok ? '已复制' : '复制失败';
                            setTimeout(() => copyReply.textContent = '复制回复', 1400);
                        });
                    });
                    actions.appendChild(copyReply);
                }
                if (m.reasoning && showReasoning) {
                    const copyThink = document.createElement('button');
                    copyThink.type = 'button';
                    copyThink.className = 'nav-pet-msg-copy';
                    copyThink.textContent = '复制思考';
                    copyThink.addEventListener('click', function() {
                        petCopyText(m.reasoning).then(function(ok) {
                            copyThink.textContent = ok ? '已复制' : '复制失败';
                            setTimeout(() => copyThink.textContent = '复制思考', 1400);
                        });
                    });
                    actions.appendChild(copyThink);
                }
                if (actions.children.length) div.appendChild(actions);
            }
            box.appendChild(div);
        });
        petChatScroll();
    }
    function petChatMetaLine(m) {
        const meta = m.meta || {};
        const parts = [];
        if (meta.model) parts.push(String(meta.model));
        if (typeof meta.elapsed_ms === 'number' && isFinite(meta.elapsed_ms)) {
            parts.push(meta.elapsed_ms >= 1000 ? (meta.elapsed_ms / 1000).toFixed(1) + 's' : meta.elapsed_ms + 'ms');
        }
        if (meta.source) parts.push(String(meta.source));
        if (meta.degraded) parts.push('兜底语料');
        if (!parts.length) return null;
        const line = document.createElement('div');
        line.className = 'nav-pet-msg-meta';
        line.textContent = parts.join(' · ');
        return line;
    }
    function petChatThinkBlock(reasoning) {
        reasoning = String(reasoning || '').trim();
        if (!reasoning) return null;
        const wrap = document.createElement('div');
        wrap.className = 'nav-pet-think';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nav-pet-think-toggle';
        btn.setAttribute('aria-expanded', 'false');
        const label = document.createElement('span');
        label.textContent = '思考详情';
        const chev = document.createElement('span');
        chev.className = 'nav-pet-think-chev';
        chev.textContent = '›';
        btn.appendChild(label);
        btn.appendChild(chev);
        const detail = document.createElement('div');
        detail.className = 'nav-pet-think-detail';
        detail.hidden = true;
        detail.textContent = reasoning;
        btn.addEventListener('click', function() {
            const open = wrap.classList.toggle('open');
            btn.classList.toggle('open', open);
            btn.setAttribute('aria-expanded', String(open));
            detail.hidden = !open;
        });
        wrap.appendChild(btn);
        wrap.appendChild(detail);
        return wrap;
    }
    function petChatAppend(role, text, links, save, reasoning, meta) {
        petChatHistory.push({role: role, text: String(text || ''), links: links || [],
                             reasoning: String(reasoning || ''), meta: meta || {}});
        if (save !== false) petChatSaveHistory();
        petChatRender();
    }
    function petCopyText(text) {
        text = String(text || '');
        if (!text) return Promise.resolve(false);
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text).then(() => true).catch(() => petCopyFallback(text));
        }
        return Promise.resolve(petCopyFallback(text));
    }
    function petCopyFallback(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        ta.remove();
        return ok;
    }
    function petChatModePaint() {
        const win = document.getElementById('navPetChatWin');
        if (!win) return;
        const m = localStorage.getItem(PET_CHAT_MODE_LS) || 'quick';
        win.querySelectorAll('[data-chat-mode]').forEach(function(b) {
            b.classList.toggle('active', b.dataset.chatMode === m);
        });
    }
    function petChatBuild() {
        if (document.getElementById('navPetChatWin')) return;
        const win = document.createElement('div');
        win.id = 'navPetChatWin';
        win.innerHTML =
            '<div class="nav-pet-chat-head" id="navPetChatDrag">' +
            '<span class="nav-pet-chat-avatar">🐳</span>' +
            '<div><div class="nav-pet-chat-title">小鲸鱼</div>' +
            '<div class="nav-pet-chat-sub" id="navPetChatSub">AI 桌宠</div></div>' +
            '<div class="nav-pet-chat-headbtns">' +
            '<button type="button" id="navPetChatGear" title="聊天设置">⚙️</button>' +
            '<button type="button" id="navPetChatClose" title="关闭">✕</button></div></div>' +
            '<div id="navPetChatSetPop">' +
            '<div class="nav-pet-set-row"><b>点桌宠默认打开</b></div>' +
            '<div class="nav-pet-set-row"><button type="button" data-chat-mode="quick">快捷气泡</button>' +
            '<button type="button" data-chat-mode="window">聊天窗口</button></div>' +
            '<div class="nav-pet-set-sep"></div>' +
            '<div class="nav-pet-set-row"><button type="button" id="navPetChatClear">清空聊天记录</button>' +
            '<button type="button" id="navPetChatOpenSet">宠物设置…</button>' +
            '<button type="button" id="navPetChatOpenAi">AI 接口…</button></div></div>' +
            '<div id="navPetChatMsgs"></div><div id="navPetChatQuick"></div>' +
            '<div id="navPetChatCompose"><textarea id="navPetChatText" rows="1" maxlength="2000" ' +
            'placeholder="跟小鲸鱼聊聊，或点上面的快捷操作…"></textarea>' +
            '<button type="button" id="navPetChatWinSend">发送</button></div>' +
            '<div class="nav-pet-resize-grip" id="navPetChatGrip" title="拖动调整聊天窗口大小"></div>';
        document.body.appendChild(win);
        const quick = document.getElementById('navPetChatQuick');
        PET_CHAT_QUICK_DEF.forEach(function(item) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'nav-pet-qbtn';
            b.dataset.quick = item[0];
            b.textContent = item[1];
            quick.appendChild(b);
        });
        function modeActive() {
            petChatModePaint();
        }
        modeActive();
        document.getElementById('navPetChatGear').addEventListener('click', function(ev) {
            ev.stopPropagation();
            document.getElementById('navPetChatSetPop').classList.toggle('show');
        });
        document.getElementById('navPetChatClose').addEventListener('click', petChatWindowClose);
        document.getElementById('navPetChatOpenSet').addEventListener('click', function() {
            // 让位 + 返场:设置弹窗自己会触发 show.bs.modal → 聊天窗临时收起,
            // 关掉设置后由 hidden.bs.modal 放回来(2026-11-19 修「两窗叠在一起」)。
            document.getElementById('navPetChatSetPop').classList.remove('show');
            bootstrap.Modal.getOrCreateInstance(petSetModal).show();
        });
        document.getElementById('navPetChatOpenAi').addEventListener('click', function() {
            // 同样让位而不是永久关:关掉 AI 接口弹窗后聊天窗自己回来(2026-11-19)
            document.getElementById('navPetChatSetPop').classList.remove('show');
            petChatSuspendForModal();
            if (window.NAV_GUEST_MODE && window.openGuestLocalAiPanel) window.openGuestLocalAiPanel();
            else if (window.petAiOpen) window.petAiOpen();
            else { petChatSuspended = false; petChatWindowOpen(); }
        });
        document.getElementById('navPetChatClear').addEventListener('click', function() {
            petChatHistory = [];
            petChatSaveHistory();
            petChatRender();
            petChatAppend('system', '聊天记录已清空', [], true);
            document.getElementById('navPetChatSetPop').classList.remove('show');
        });
        win.querySelectorAll('[data-chat-mode]').forEach(function(b) {
            b.addEventListener('click', function() {
                localStorage.setItem(PET_CHAT_MODE_LS, b.dataset.chatMode);
                modeActive();
            });
        });
        quick.addEventListener('click', function(ev) {
            const b = ev.target.closest('[data-quick]');
            if (!b) return;
            const id = b.dataset.quick;
            if (id === 'search') {
                petChatPendingAction = 'search';
                const inp = document.getElementById('navPetChatText');
                inp.placeholder = '输入要搜的站点关键词，回车搜索…';
                inp.focus();
                return;
            }
            if (id === 'ai-find') {
                petChatAppend('system', '已打开「AI 找网站」', [], true);
                petChatWindowClose();
                if (window.NAV_GUEST_MODE && window.navGuestAi) window.navGuestAi.openFind();
                else if (window.navAiOpen) window.navAiOpen();
                return;
            }
            if (id === 'ai-classify') {
                petChatAppend('system', '已打开「AI 分类」', [], true);
                petChatWindowClose();
                if (window.NAV_GUEST_MODE && window.navGuestAi) window.navGuestAi.openClassify();
                else if (window.navAiClassifyOpen) window.navAiClassifyOpen();
                return;
            }
            petChatQuickSend(id, '');
        });
        const send = document.getElementById('navPetChatWinSend');
        const inp = document.getElementById('navPetChatText');
        send.addEventListener('click', petChatWindowSend);
        inp.addEventListener('keydown', function(ev) {
            if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); petChatWindowSend(); }
        });
        // 标题栏拖动
        const head = document.getElementById('navPetChatDrag');
        let drag = null;
        head.addEventListener('pointerdown', function(ev) {
            if (ev.target.closest('button')) return;
            drag = {x: ev.clientX, y: ev.clientY, l: win.offsetLeft, t: win.offsetTop};
            win.style.right = 'auto'; win.style.bottom = 'auto';
        });
        document.addEventListener('pointermove', function(ev) {
            if (!drag) return;
            win.style.left = Math.max(8, Math.min(window.innerWidth - win.offsetWidth - 8,
                drag.l + ev.clientX - drag.x)) + 'px';
            win.style.top = Math.max(48, Math.min(window.innerHeight - 40,
                drag.t + ev.clientY - drag.y)) + 'px';
        });
        document.addEventListener('pointerup', function() { if (drag) { drag = null; petChatSavePos(); } });
        // 右下角缩放
        const grip = document.getElementById('navPetChatGrip');
        grip.addEventListener('pointerdown', function(ev) {
            ev.preventDefault();
            const sx = ev.clientX, sy = ev.clientY, r = win.getBoundingClientRect();
            function move(e) {
                win.style.width = Math.max(280, r.width + e.clientX - sx) + 'px';
                win.style.height = Math.max(300, r.height + e.clientY - sy) + 'px';
            }
            function up() {
                document.removeEventListener('pointermove', move);
                document.removeEventListener('pointerup', up);
                petChatSavePos();
            }
            document.addEventListener('pointermove', move);
            document.addEventListener('pointerup', up, {once: true});
        });
    }
    function petChatSavePos() {
        const win = document.getElementById('navPetChatWin');
        if (!win) return;
        try {
            localStorage.setItem(PET_CHAT_POS_LS, JSON.stringify({
                left: win.offsetLeft, top: win.offsetTop,
                width: win.offsetWidth, height: win.offsetHeight
            }));
        } catch (e) {}
    }
    function petChatWindowOpen(skipFocus) {
        petChatBuild();
        const win = document.getElementById('navPetChatWin');
        if (!win) return;
        win.classList.add('show');
        petChatModePaint();
        let pos = null;
        try { pos = JSON.parse(localStorage.getItem(PET_CHAT_POS_LS) || 'null'); } catch (e) {}
        if (pos && pos.width && pos.height) {
            win.style.width = Math.min(Math.max(280, pos.width), Math.max(280, window.innerWidth - 16)) + 'px';
            win.style.height = Math.min(Math.max(300, pos.height), Math.max(300, window.innerHeight - 80)) + 'px';
        }
        if (pos && isFinite(pos.left) && isFinite(pos.top)) {
            win.style.right = 'auto'; win.style.bottom = 'auto';
            win.style.left = Math.min(Math.max(8, pos.left), Math.max(8, window.innerWidth - win.offsetWidth - 8)) + 'px';
            win.style.top = Math.min(Math.max(48, pos.top), Math.max(48, window.innerHeight - 40)) + 'px';
        } else {
            const pet = document.getElementById('navPet');
            const pr = pet ? pet.getBoundingClientRect() : {left: 40, right: 140, bottom: window.innerHeight - 40};
            let left = pr.left - win.offsetWidth - 12;
            if (left < 8) left = pr.right + 12;
            if (left + win.offsetWidth > window.innerWidth - 8) left = window.innerWidth - win.offsetWidth - 8;
            let top = pr.bottom - win.offsetHeight;
            top = Math.max(56, Math.min(top, window.innerHeight - win.offsetHeight - 8));
            win.style.right = 'auto'; win.style.bottom = 'auto';
            win.style.left = Math.max(8, left) + 'px';
            win.style.top = top + 'px';
        }
        const sub = document.getElementById('navPetChatSub');
        if (sub) sub.textContent = window.NAV_GUEST_MODE
            ? (window.navGuestAi && window.navGuestAi.configured() ? '自带 Key · 仅本机' : '未配置 · 点 ⚙️ 填接口')
            : ((petAiReady === false) ? 'AI 未配置 · 快捷操作可用' : 'AI 桌宠');
        petChatRender();
        const inp = document.getElementById('navPetChatText');
        if (inp && !skipFocus) setTimeout(function() { inp.focus(); }, 50);
    }
    function petChatWindowClose() {
        const win = document.getElementById('navPetChatWin');
        if (win) win.classList.remove('show');
        const pop = document.getElementById('navPetChatSetPop');
        if (pop) pop.classList.remove('show');
    }
    // 弹窗让位:只把聊天窗暂时收起,记一笔;等弹窗全关掉再自己回来。
    // 2026-11-19 用户反馈「点其他设置返回,聊天窗就自动隐藏」——之前是永久 close,收不回来。
    let petChatSuspended = false;
    function petChatSuspendForModal() {
        const win = document.getElementById('navPetChatWin');
        if (!win) return;
        if (win.classList.contains('show')) {
            win.classList.remove('show');
            petChatSuspended = true;
        }
        const pop = document.getElementById('navPetChatSetPop');
        if (pop) pop.classList.remove('show');
    }
    function petChatQuickSend(action, query) {
        const labels = {random: '随机来一个站点', stats: '看看站点统计'};
        if (action !== 'search') petChatAppend('user', labels[action] || action);
        petChatWinBusy = true;
        petChatTyping(true);
        const quickReq = (window.NAV_GUEST_MODE && window.navGuestAi)
            ? window.navGuestAi.quick(action, query || '')
            : petAiPost(PET_AI_URLS.quick, {action: action, query: query || ''});
        quickReq.then(function(d) {
            petChatWinBusy = false;
            petChatTyping(false);
            if (d && d.status === 'ok') {
                petChatAppend('pet', d.reply || '', d.links || [], true, d.reasoning || '',
                              {model: d.model || '', elapsed_ms: d.elapsed_ms, source: d.source || '', degraded: !!d.degraded});
                petBeep('ding');
            } else {
                petChatAppend('pet', (d && d.message) || '这个操作没成功，再试一次？', [], true);
            }
        }).catch(function() {
            petChatWinBusy = false;
            petChatTyping(false);
            petChatAppend('pet', '网络好像不太顺，等下再试', [], true);
        });
    }
    function petChatWindowSend() {
        const inp = document.getElementById('navPetChatText');
        const text = ((inp && inp.value) || '').trim();
        if (!text || petChatWinBusy) return;
        inp.value = '';
        const pending = petChatPendingAction;
        petChatPendingAction = '';
        if (pending === 'search') {
            inp.placeholder = '跟小鲸鱼聊聊，或点上面的快捷操作…';
            petChatQuickSend('search', text);
            return;
        }
        if (text.charAt(0) === '/' && petCommand(text)) {
            petChatAppend('system', '已执行动作指令：' + text, [], true);
            return;
        }
        petChatAppend('user', text);
        petChatWinBusy = true;
        petChatTyping(true);
        petPlayByName(PET_POOL.work[0]);
        const chatReq = (window.NAV_GUEST_MODE && window.navGuestAi)
            ? window.navGuestAi.chat(text, petChatHistory)
            : petAiPost(PET_AI_URLS.chat, {text: text});
        chatReq.then(function(d) {
            petChatWinBusy = false;
            petChatTyping(false);
            if (d && d.status === 'ok') {
                petAiReady = true;
                petChatAppend('pet', d.reply || '', [], true, d.reasoning || '',
                              {model: d.model || '', elapsed_ms: d.elapsed_ms, source: d.source || '', degraded: !!d.degraded});
                if (d.meme) petMeme(d.meme);
                window.navPetState('happy');
                petBeep('greet');
            } else {
                if (d && d.configured === false) petAiReady = false;
                petChatAppend('pet', (d && d.message) || '我走神了，再说一遍好不好', [], true);
            }
        }).catch(function() {
            petChatWinBusy = false;
            petChatTyping(false);
            petChatAppend('pet', '网络好像不太顺，等下再聊', [], true);
        });
    }
    window.petAiChatOpen = function(mode) {
        const m = mode || localStorage.getItem(PET_CHAT_MODE_LS) || 'quick';
        if (m === 'quick') { petAiQuickOpen(); return; }
        petChatWindowOpen();
    };
    // 任何 Bootstrap 弹窗打开时,把浮在页面上的聊天窗/快捷气泡收起:
    // 聊天窗 z-index 再高也不能盖住 AI 分类/AI 接口/设置这些模态窗(2026-11-18 截图实测)。
    document.addEventListener('show.bs.modal', function() {
        // 任何弹窗(含宠物设置)都让聊天窗暂时让位——两个窗口并排/叠着会互相压住
        // (2026-11-19 用户截图:设置窗把聊天窗左半边遮掉一半);关完由 hidden 还原。
        petChatSuspendForModal();
        if (window.petAiChatClose) window.petAiChatClose();
    });
    // 最后一个弹窗关掉时把让位的聊天窗放回来(用户自己关的、快捷动作主动收的不受影响)
    document.addEventListener('hidden.bs.modal', function() {
        if (!petChatSuspended) return;
        if (document.querySelector('.modal.show') || document.body.classList.contains('modal-open')) return;
        petChatSuspended = false;
        petChatWindowOpen(true);   // 还原时不抢焦点
    });
    // 点聊天设置外面关掉设置浮层(聊天窗口本身不因点外面而关闭,和微信一致)
    document.addEventListener('click', function(ev) {
        const pop = document.getElementById('navPetChatSetPop');
        if (pop && pop.classList.contains('show') &&
            !pop.contains(ev.target) && !ev.target.closest('#navPetChatGear')) pop.classList.remove('show');
    });
    // AI 碎碎念:失败静默回落本地语录(不伪造 AI 文案,不打断任何玩法)
    function petAiWhisper() {
        if (petAiBusy) { petSay(); return; }
        if (window.NAV_GUEST_MODE) {
            if (!window.navGuestAi || !window.navGuestAi.configured()) { petSay(); return; }
            petAiBusy = true;
            window.navGuestAi.whisper().then(function(d) {
                petAiBusy = false;
                if (d && d.status === 'ok') petSay(d.text, 5200);
                else petSay();
            }).catch(function() { petAiBusy = false; petSay(); });
            return;
        }
        if (petAiReady === false) { petSay(); return; }
        petAiBusy = true;
        petAiPost(PET_AI_URLS.whisper).then(function(d) {
            petAiBusy = false;
            if (d.status === 'ok') {
                petAiReady = true;
                petSay(d.text, 5200);
                if (d.meme) petMeme(d.meme);
            } else {
                if (d.configured === false) petAiReady = false;
                petSay();
            }
        }).catch(function() { petAiBusy = false; petSay(); });
    }
    // DeepSeek 余额:按已用百分比分档播「余额-」动画(池子早就搬好了,今天终于接上)
    window.petAiBalance = function() {
        if (petAiReady === false) {
            petSay(window.NAV_GUEST_MODE ? '还没填本机接口,查不了余额~ 点「AI 接口与对话」配置'
                : '还没接 AI 接口,查不了余额~ 点顶栏「AI 接口」配置', 3600);
            return;
        }
        petSay('我看看钱包…', 4000);
        const balReq = (window.NAV_GUEST_MODE && window.navGuestAi)
            ? window.navGuestAi.balance()
            : fetch(PET_AI_URLS.balance).then(r => r.json());
        balReq.then(function(d) {
            if (d.status !== 'ok') { petSay(d.message || '查不到余额', 3600); return; }
            petAiReady = true;
            const bal = parseFloat(d.total_balance);
            if (isNaN(bal)) { petSay('钱包好像被谁藏起来了…', 3200); return; }
            const pct = Math.max(0, Math.min(100, bal));   // 余额绝对值当满格百分比的近似(dsh-pet 同款分档)
            const idx = pct <= 0 ? 0 : Math.min(5, Math.floor(pct / 20) + 1);
            petPlayByName(PET_POOL.balance[Math.min(idx, PET_POOL.balance.length - 1)]);
            petSay(d.is_available ? '💰 余额还有 ' + d.total_balance + ' ' + d.currency : '⚠️ 账户已不可用,余额 ' + d.total_balance + ' ' + d.currency, 6000, PET_BUBBLE_PRIO.balance);
             petBeep('ding');
         }).catch(function() { petSay('余额查询失败了,网络可能不太好', 3200); });
     };

    // ===== 吃白饭:完整玩法(移植 dsh-pet src/client/baifan 的 scene + show + lock) =====
    // 上游是五相位机(walk → expect → chase → eat → 收场),靠「动画播完」推进,不用定时器估时长;
    // 网页版把「宿主占用锁」换成本地忙标志(没有第三方抢宠物),走路用 rAF 插值到目标像素。
    const BAIFAN = {
        travelMs: 2600, spawnMs: 2200, maxRice: 2, eatPx: 44,
        bowlRatio: 0.38, ballRatio: 0.22, budgetMs: 30000,
        gravity: 1900, footRatio: 0.894, chaseSpeed: 300
    };
    const BAIFAN_LINES = {
        down: ['饭来了饭来了!', '闻着味儿就来了~', '开饭开饭!'],
        expect: ['坐好等饭~', '碗呢?碗呢?', '快点快点!'],
        bowl: ['一整碗!', '这碗归我~', '先吃这碗'],
        ball: ['饭团也不错~', '一口一个', '香!'],
        full: ['吃饱啦!', '这顿值了~'],
        busy: ['还没吃完呢,排队~']
    };
    let bfHold = false;   // 演出期间由玩法自己推进动画,中央 ended 处理别抢
    let bfRun = null;     // 当前这一场(非 null = 忙)

    function bfSleep(ms) { return new Promise(function(res) { setTimeout(res, ms); }); }
    function bfPick(pool) { return pool[Math.floor(Math.random() * pool.length)]; }
    function bfLayer() {
        let layer = document.getElementById('navBaifanLayer');
        if (!layer) {
            layer = document.createElement('div');
            layer.id = 'navBaifanLayer';
            const toast = document.createElement('div');
            toast.className = 'bf-toast';
            layer.appendChild(toast);
            document.body.appendChild(layer);
        }
        return layer;
    }
    function bfToast(text) {
        const t = bfLayer().querySelector('.bf-toast');
        if (!t) return;
        t.textContent = text;
        t.classList.add('show');
        clearTimeout(t._t);
        t._t = setTimeout(function() { t.classList.remove('show'); }, 1800);
    }
    function bfMetrics() {
        const pet = document.getElementById('navPet');
        const v = pet && pet.querySelector('.nav-pet-video');
        const w = (v && v.getBoundingClientRect().width) || 128;
        return {
            pet: pet, video: v, w: w, h: w * 0.5625,
            x: parseFloat(pet && pet.style.left) || 0,
            y: parseFloat(pet && pet.style.top) || 0
        };
    }
    // 走到指定像素(rAF 插值;演出期间关掉 CSS 过渡,收场恢复)
    function bfGlideTo(x, y, ms) {
        return new Promise(function(resolve) {
            const pet = document.getElementById('navPet');
            if (!pet) { resolve(); return; }
            const x0 = parseFloat(pet.style.left) || 0;
            const y0 = parseFloat(pet.style.top) || 0;
            const prev = pet.style.transition;
            pet.style.transition = 'none';
            const t0 = performance.now();
            (function step() {
                const k = Math.min(1, (performance.now() - t0) / Math.max(1, ms));
                const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
                pet.style.left = Math.round(x0 + (x - x0) * e) + 'px';
                pet.style.top = Math.round(y0 + (y - y0) * e) + 'px';
                if (k < 1) requestAnimationFrame(step);
                else { pet.style.transition = prev; resolve(); }
            })();
        });
    }
    // 播一段动画并等它播完(代替上游的 playback 回执;超时兜底,免得某条素材缺帧卡死整场)
    function bfAnimOnce(name, timeoutMs) {
        return new Promise(function(resolve) {
            const pet = document.getElementById('navPet');
            const v = pet && pet.querySelector('.nav-pet-video');
            if (!pet || !v) { resolve(); return; }
            let done = false;
            const finish = function() {
                if (done) return;
                done = true;
                v.removeEventListener('ended', finish);
                bfHold = false;
                resolve();
            };
            bfHold = true;
            v.addEventListener('ended', finish);
            petPlayByName(name);
            setTimeout(finish, timeoutMs || 9000);
        });
    }
    // 掉一份饭:碗或饭团,自由落体 + 自转,落地停住(只在有东西还在天上时才跑 rAF)
    function bfSpawnRice(type, groundY) {
        const m = bfMetrics();
        const w = Math.max(22, m.w * (type === 'bowl' ? BAIFAN.bowlRatio : BAIFAN.ballRatio));
        const img = document.createElement('img');
        img.className = 'bf-rice';
        img.alt = '';
        img.src = '/static/pet/baifan/' + (type === 'bowl' ? 'bowl-full.png' : 'rice-ball.png');
        img.style.width = Math.round(w) + 'px';
        const item = {
            el: img, type: type, w: w, h: w, groundY: groundY,
            x: Math.round(60 + Math.random() * Math.max(40, window.innerWidth - 120)),
            y: -w, vy: 0, rot: Math.random() * 60 - 30,
            spin: (Math.random() < 0.5 ? -1 : 1) * (60 + Math.random() * 140),
            state: 'falling'
        };
        img.style.left = Math.round(item.x - w / 2) + 'px';
        img.style.top = Math.round(item.y) + 'px';
        bfLayer().appendChild(img);
        bfRun.items.push(item);
        bfRunAnim();
        return item;
    }
    function bfRunAnim() {
        if (!bfRun || bfRun.raf) return;
        let last = performance.now();
        const step = function(ts) {
            if (!bfRun) return;
            const dt = Math.min(0.05, (ts - last) / 1000); last = ts;
            let flying = false;
            bfRun.items.forEach(function(it) {
                if (it.state !== 'falling') return;
                it.vy += BAIFAN.gravity * dt;
                it.y += it.vy * dt;
                it.rot += it.spin * dt;
                if (it.y + it.h >= it.groundY) { it.y = it.groundY - it.h; it.state = 'ground'; }
                else flying = true;
                it.el.style.top = Math.round(it.y) + 'px';
                it.el.style.transform = 'rotate(' + Math.round(it.rot) + 'deg)';
            });
            bfRun.raf = flying ? requestAnimationFrame(step) : 0;
        };
        bfRun.raf = requestAnimationFrame(step);
    }
    async function bfEat(item) {
        if (!bfRun) return;
        item.el.remove();
        bfRun.items = bfRun.items.filter(function(x) { return x !== item; });
        bfRun.eaten += 1;
        const isBowl = item.type === 'bowl';
        await bfAnimOnce(isBowl ? '吃饭·碗饭' : '吃饭团');
        if (!bfRun) return;
        const sc = document.createElement('div');
        sc.className = 'bf-score';
        sc.textContent = '+' + (isBowl ? 3 : 1);
        sc.style.left = Math.round(item.x) + 'px';
        sc.style.top = Math.round(item.y - 10) + 'px';
        bfLayer().appendChild(sc);
        setTimeout(function() { sc.remove(); }, 1000);
        petScoreAdd(isBowl ? 3 : 1);
        petSay(bfPick(isBowl ? BAIFAN_LINES.bowl : BAIFAN_LINES.ball), 1600);
        petBeep('pop');
        // 碗吃完变空碗(留在场上 600ms 再收走,视觉上「吃干净了」)
        const empty = document.createElement('img');
        empty.className = 'bf-rice';
        empty.alt = '';
        empty.src = '/static/pet/baifan/bowl-empty.png';
        empty.style.width = Math.round(item.w) + 'px';
        empty.style.left = Math.round(item.x - item.w / 2) + 'px';
        empty.style.top = Math.round(item.y) + 'px';
        bfLayer().appendChild(empty);
        setTimeout(function() { empty.remove(); }, 600);
    }
    async function bfChase(deadline) {
        let nextSpawn = performance.now() + 500;
        while (bfRun && performance.now() < deadline) {
            const items = bfRun.items;
            if (items.length < BAIFAN.maxRice && performance.now() >= nextSpawn) {
                bfSpawnRice(Math.random() < 0.6 ? 'bowl' : 'ball', bfRun.groundY);
                nextSpawn = performance.now() + BAIFAN.spawnMs;
            }
            const grounded = items.filter(function(i) { return i.state === 'ground'; });
            if (!grounded.length) { await bfSleep(120); continue; }
            let target = grounded[0];
            grounded.forEach(function(i) {
                if (Math.abs(i.x - bfRun.petX) < Math.abs(target.x - bfRun.petX)) target = i;
            });
            const dx = target.x - bfRun.petX;
            if (Math.abs(dx) <= BAIFAN.eatPx) { await bfEat(target); continue; }
            const pet = document.getElementById('navPet');
            if (!pet) return;
            const stepPx = Math.min(Math.abs(dx), Math.max(6, BAIFAN.chaseSpeed * 0.08));
            bfRun.petX += dx > 0 ? stepPx : -stepPx;
            const left = Math.max(4, Math.min(window.innerWidth - bfRun.petW - 4, bfRun.petX - bfRun.petW / 2));
            pet.style.left = Math.round(left) + 'px';
            const v = pet.querySelector('.nav-pet-video');
            if (v) v.style.transform = dx > 0 ? '' : 'scaleX(-1)';
            await bfSleep(80);
        }
    }
    async function petBaifanEnd() {
        const pet = document.getElementById('navPet');
        if (bfRun) {
            bfRun.items.forEach(function(i) { i.el.remove(); });
            if (bfRun.raf) cancelAnimationFrame(bfRun.raf);
            bfRun = null;
        }
        bfHold = false;
        window.petBaifanBusy = false;
        const v = pet && pet.querySelector('.nav-pet-video');
        if (v) { v.style.transform = ''; v.loop = true; }
        const bfLayerEnd = document.getElementById('navBaifanLayer');
        if (bfLayerEnd) bfLayerEnd.querySelectorAll('.bf-rice, .bf-score').forEach(function(el) { el.remove(); });
        petSay(bfPick(BAIFAN_LINES.full), 2400);
        petBeep('ding');
        if (pet && pet._petPlay) pet._petPlay('idle');
    }
    // 用户抓走/中途打断:立刻收场,不报错(对应上游 Halted)
    function petBaifanHalt() {
        if (!bfRun) return;
        bfRun.items.forEach(function(i) { i.el.remove(); });
        if (bfRun.raf) cancelAnimationFrame(bfRun.raf);
        bfRun = null;
        bfHold = false;
        window.petBaifanBusy = false;
        const pet = document.getElementById('navPet');
        const v = pet && pet.querySelector('.nav-pet-video');
        if (v) { v.style.transform = ''; v.loop = true; }
        const bfLayerHalt = document.getElementById('navBaifanLayer');
        if (bfLayerHalt) bfLayerHalt.querySelectorAll('.bf-rice, .bf-score').forEach(function(el) { el.remove(); });
    }
    async function petBaifanStart() {
        const pet = document.getElementById('navPet');
        if (!pet || !pet._petPlayName) return;
        if (bfRun) { petSay(bfPick(BAIFAN_LINES.busy), 1600); return; }
        delete pet.dataset.sleeping;
        delete pet.dataset.manualSleep;
        delete pet.dataset.sleepPhase;
        const m = bfMetrics();
        bfRun = {
            items: [], raf: 0, eaten: 0,
            petW: m.w, petX: m.x + m.w / 2, petY: m.y,
            groundY: m.y + m.h * BAIFAN.footRatio,
            deadline: performance.now() + BAIFAN.budgetMs
        };
        window.petBaifanBusy = true;
        bfLayer();
        bfToast('吃白饭开始~');
        petSay(bfPick(BAIFAN_LINES.down), 2000);
        petBeep('greet');
        const v = pet.querySelector('.nav-pet-video');
        // 1) 跑到饭点
        pet._petPlayName('开心小跑');
        if (v) { v.loop = true; v.style.transform = ''; }
        const targetX = Math.round(window.innerWidth * (Math.random() < 0.5 ? 0.32 : 0.62));
        await bfGlideTo(Math.max(8, targetX - m.w / 2), bfRun.petY, BAIFAN.travelMs);
        if (!bfRun) return;
        bfRun.petX = Math.max(m.w / 2, Math.min(window.innerWidth - m.w / 2, targetX));
        // 2) 期待开饭
        petSay(bfPick(BAIFAN_LINES.expect), 2000);
        await bfAnimOnce('期待开饭', 8000);
        if (!bfRun) return;
        // 3) 追着吃
        pet._petPlayName('开心小跑');
        if (v) { v.loop = true; v.style.transform = ''; }
        await bfChase(bfRun.deadline);
        // 4) 收场
        await petBaifanEnd();
    }
    window.petBaifanStart = petBaifanStart;
    window.petBaifanHalt = petBaifanHalt;
});