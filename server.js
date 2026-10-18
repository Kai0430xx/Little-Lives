import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import {
  randomUUID,
  scryptSync,
  timingSafeEqual
} from 'node:crypto';

await mkdir('.data', { recursive: true });

const db = new DatabaseSync('.data/game.sqlite');

db.exec(`
  CREATE TABLE IF NOT EXISTS homes (
    id TEXT PRIMARY KEY,
    password TEXT,
    state TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user TEXT
  );

  CREATE TABLE IF NOT EXISTS accounts (
    name TEXT PRIMARY KEY,
    salt TEXT,
    password TEXT,
    user TEXT
  );
`);

function json(res, status, data) {
  res.writeHead(status, {
    'content-type': 'application/json'
  });

  res.end(JSON.stringify(data));
}

function hash(password) {
  return scryptSync(
    password,
    'little-lives-home',
    32
  ).toString('hex');
}

function energy(pet) {
  const elapsed = Date.now() - (pet.updated || pet.fed);

  return Math.max(
    0,
    pet.energy - elapsed / 864000
  );
}

async function body(req) {
  let raw = '';

  for await (const chunk of req) {
    raw += chunk;

    if (raw.length > 12000) {
      throw Error('請求過大');
    }
  }

  return JSON.parse(raw || '{}');
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/api/config') {
      return json(res, 200, {
        googleClientId: process.env.GOOGLE_CLIENT_ID || ''
      });
    }

    // 註冊與登入
    if (
      req.method === 'POST' &&
      url.pathname === '/api/login'
    ) {
      const input = await body(req);

      const name = String(input.account || '')
        .trim()
        .toLowerCase();

      if (!/^[a-z0-9_]{3,24}$/.test(name)) {
        throw Error(
          '帳號需為 3～24 位英文字母、數字或底線'
        );
      }

      if (
        typeof input.password !== 'string' ||
        input.password.length < 8 ||
        input.password.length > 128
      ) {
        throw Error('密碼需為 8～128 個字元');
      }

      const account = db.prepare(
        'SELECT * FROM accounts WHERE name=?'
      ).get(name);

      let user;

      if (input.register) {
        if (account) {
          throw Error('帳號已有人使用');
        }

        const salt = randomUUID();

        user = {
          id: randomUUID(),
          name: String(input.name || name).slice(0, 20)
        };

        const passwordHash = scryptSync(
          input.password,
          salt,
          64
        ).toString('hex');

        db.prepare(
          'INSERT INTO accounts VALUES(?,?,?,?)'
        ).run(
          name,
          salt,
          passwordHash,
          JSON.stringify(user)
        );
      } else {
        if (
          !account ||
          !timingSafeEqual(
            scryptSync(
              input.password,
              account.salt,
              64
            ),
            Buffer.from(account.password, 'hex')
          )
        ) {
          throw Error('帳號或密碼不正確');
        }

        user = JSON.parse(account.user);
      }

      const token = randomUUID();

      db.prepare(
        'INSERT INTO sessions VALUES(?,?)'
      ).run(token, JSON.stringify(user));

      return json(res, 200, {
        token,
        user
      });
    }

    if (url.pathname.startsWith('/api/')) {
      const token = req.headers.authorization
        ?.replace('Bearer ', '');

      const session = db.prepare(
        'SELECT user FROM sessions WHERE token=?'
      ).get(token);

      if (!session) {
        return json(res, 401, {
          error: '請先登入'
        });
      }

      const user = JSON.parse(session.user);

      // 列出自己的家園
      if (url.pathname === '/api/mine') {
        const homes = db.prepare(
          'SELECT state FROM homes'
        ).all()
          .map(row => JSON.parse(row.state))
          .filter(home =>
            home.members.includes(user.id)
          )
          .map(home => ({
            id: home.id,
            name: home.name
          }));

        return json(res, 200, homes);
      }

      // 建立家園
      if (
        url.pathname === '/api/homes' &&
        req.method === 'POST'
      ) {
        const input = await body(req);

        if (
          !input.password ||
          input.password.length < 4
        ) {
          throw Error('密碼至少 4 碼');
        }

        const id = randomUUID().slice(0, 8);

        const state = {
          id,
          name: String(
            input.name || '暖陽小院'
          ).slice(0, 24),
          owner: user.id,
          members: [user.id],
          pets: [],
          plots: Array.from(
            { length: 6 },
            () => null
          ),
          chat: [],
          clean: {},
          day: '',
          coins: {
            [user.id]: 20
          },
          food: {
            [user.id]: 6
          },
          farm: false,
          care: 0
        };

        db.prepare(
          'INSERT INTO homes VALUES(?,?,?)'
        ).run(
          id,
          hash(input.password),
          JSON.stringify(state)
        );

        return json(res, 200, state);
      }

      const homeId = url.searchParams.get('id');

      const row = db.prepare(
        'SELECT * FROM homes WHERE id=?'
      ).get(homeId);

      if (!row) {
        throw Error('找不到家園，請確認邀請代碼');
      }

      const state = JSON.parse(row.state);

      // 加入家園
      if (url.pathname === '/api/join') {
        const input = await body(req);

        const correct = timingSafeEqual(
          Buffer.from(hash(input.password || '')),
          Buffer.from(row.password)
        );

        if (!correct) {
          throw Error('家園密碼不正確');
        }

        if (!state.members.includes(user.id)) {
          if (state.members.length >= 5) {
            throw Error('家園已滿 5 人');
          }

          state.members.push(user.id);
          state.coins[user.id] = 20;
          state.food[user.id] = 6;
        }
      } else if (
        !state.members.includes(user.id)
      ) {
        return json(res, 403, {
          error: '需要邀請代碼及密碼加入'
        });
      }

      // 每日清掃進度重置
      const day = new Intl.DateTimeFormat(
        'en-CA',
        {
          timeZone: 'Asia/Taipei'
        }
      ).format(new Date());

      if (state.day !== day) {
        state.day = day;
        state.clean = {};
      }

      if (
        req.method === 'POST' &&
        url.pathname === '/api/action'
      ) {
        const input = await body(req);

        const pet = state.pets.find(
          pet => pet.id === input.pet
        );

        const ownPet = state.pets.find(
          pet => pet.owner === user.id
        );

        // 建立寵物
        if (input.type === 'pet') {
          if (
            ownPet &&
            Date.now() - ownPet.fed >= 432000000
          ) {
            state.letters ??= [];

            state.letters.push({
              owner: user.id,
              name: ownPet.name,
              at: Date.now()
            });

            state.pets = state.pets.filter(
              pet => pet.id !== ownPet.id
            );
          } else if (ownPet) {
            throw Error(
              '每個家園只能建立一隻寵物'
            );
          }

          const toys = [
            '🎾',
            '🧸',
            '🪀',
            '🏐',
            '🪁'
          ];

          state.pets.push({
            id: randomUUID(),
            owner: user.id,
            name: String(
              input.name || '糯米'
            ).slice(0, 12),
            kind: input.kind === 'cat'
              ? 'cat'
              : 'dog',
            breed: input.breed,
            zodiac: input.zodiac,
            color: input.color || '#d5a76d',
            fed: Date.now(),
            updated: Date.now(),
            energy: 100,
            mood: 60,
            xp: 0,
            toy: toys[state.pets.length],
            waste: [],
            lastWaste: Date.now(),
            x: 12 + state.pets.length * 17,
            y: 22
          });
        }

        // 離家後不能直接餵食或互動
        if (
          pet &&
          Date.now() - pet.fed >= 172800000 &&
          ['feed', 'play', 'stroke'].includes(
            input.type
          )
        ) {
          throw Error('寵物已離家，請先完成尋找');
        }

        // 餵食
        if (input.type === 'feed') {
          if (!pet) {
            throw Error('寵物不存在');
          }

          if (energy(pet) >= 99.99) {
            throw Error('已經吃飽了');
          }

          if (state.food[user.id] < 1) {
            throw Error('飼料不足');
          }

          state.food[user.id]--;

          pet.energy = Math.min(
            100,
            energy(pet) + 100 / 3
          );

          pet.updated = Date.now();
          pet.fed = Date.now();
          pet.mood = Math.min(
            100,
            pet.mood + 4
          );
          pet.xp += 2;

          state.care++;
        }

        // 原型尋找流程
        if (input.type === 'recover') {
          if (
            !pet ||
            pet.owner !== user.id ||
            Date.now() - pet.fed < 172800000 ||
            Date.now() - pet.fed >= 432000000
          ) {
            throw Error('不在找回期限內');
          }

          pet.search = (pet.search || 0) + 1;

          if (pet.search >= 3) {
            if (state.food[user.id] < 1) {
              throw Error('需要一份飼料接回');
            }

            state.food[user.id]--;

            pet.fed = Date.now();
            pet.updated = Date.now();
            pet.energy = 50;
            pet.search = 0;
          }
        }

        // 摸摸與玩耍
        if (
          input.type === 'play' ||
          input.type === 'stroke'
        ) {
          if (!pet || energy(pet) <= 0) {
            throw Error(
              '寵物餓了，先餵食吧'
            );
          }

          pet.energy = Math.max(
            0,
            energy(pet) - 2
          );

          pet.updated = Date.now();

          pet.mood = Math.min(
            100,
            pet.mood + 8
          );

          pet.xp += 3;
        }

        // 清掃與確認
        if (input.type === 'clean') {
          if (
            !pet ||
            !pet.waste.includes(input.waste)
          ) {
            throw Error('已被朋友清理');
          }

          if (
            (state.clean[user.id] || 0) >= 3 &&
            !input.confirm
          ) {
            return json(res, 200, {
              confirm: true
            });
          }

          pet.waste = pet.waste.filter(
            waste => waste !== input.waste
          );

          state.clean[user.id] =
            (state.clean[user.id] || 0) + 1;

          state.coins[user.id]++;
        }

        // 購買飼料
        if (input.type === 'buy') {
          if (state.coins[user.id] < 6) {
            throw Error('需要 6 金幣');
          }

          state.coins[user.id] -= 6;
          state.food[user.id]++;
        }

        // 聊天
        if (input.type === 'chat') {
          const text = String(
            input.text || ''
          ).trim().slice(0, 200);

          if (text) {
            state.chat.push({
              name: user.name,
              text,
              at: Date.now()
            });
          }

          state.chat = state.chat.slice(-80);
        }

        // 解鎖農田
        if (input.type === 'unlock') {
          if (state.care < 5) {
            throw Error(
              '家園需要完成 5 次餵食'
            );
          }

          state.farm = true;
        }

        // 播種
        if (input.type === 'plant') {
          if (
            !state.farm ||
            state.plots[input.index] !== null
          ) {
            throw Error('無法播種');
          }

          if (state.coins[user.id] < 3) {
            throw Error('種子需要 3 金幣');
          }

          state.coins[user.id] -= 3;

          state.plots[input.index] = {
            owner: user.id,
            at: Date.now(),
            crop: input.crop || '🥕'
          };
        }

        // 收成
        if (input.type === 'harvest') {
          const plot =
            state.plots[input.index];

          if (
            !plot ||
            Date.now() - plot.at < 7200000
          ) {
            throw Error('作物尚未成熟');
          }

          state.coins[plot.owner] += 8;
          state.plots[input.index] = null;
        }

        // 放置小屋
        if (input.type === 'move') {
          if (
            !pet ||
            pet.owner !== user.id
          ) {
            throw Error(
              '只能移動自己的小屋'
            );
          }

          pet.x = Math.max(
            4,
            Math.min(
              86,
              Number(input.x) || 4
            )
          );

          pet.y = Math.max(
            8,
            Math.min(
              65,
              Number(input.y) || 8
            )
          );
        }
      }

      // 原型排泄物生成
      for (const pet of state.pets) {
        if (
          Date.now() - pet.lastWaste > 14400000 &&
          pet.waste.length < 3
        ) {
          pet.waste.push(randomUUID());
          pet.lastWaste = Date.now();
        }
      }

      db.prepare(
        'UPDATE homes SET state=? WHERE id=?'
      ).run(
        JSON.stringify(state),
        state.id
      );

      return json(res, 200, state);
    }

    // 靜態網頁
    const path = url.pathname === '/'
      ? '/index.html'
      : url.pathname;

    if (
      !/^\/[a-zA-Z0-9.\/-]+$/.test(path) ||
      path.includes('..')
    ) {
      return json(res, 404, {});
    }

    const data = await readFile(
      'public' + path
    );

    const types = {
      html: 'text/html',
      js: 'text/javascript',
      css: 'text/css',
      webmanifest:
        'application/manifest+json',
      svg: 'image/svg+xml'
    };

    const extension = path
      .split('.')
      .pop();

    res.writeHead(200, {
      'content-type':
        types[extension] || 'text/plain'
    });

    res.end(data);
  } catch (error) {
    json(res, 400, {
      error: error.message
    });
  }
}).listen(
  process.env.PORT || 3000,
  '0.0.0.0'
);
