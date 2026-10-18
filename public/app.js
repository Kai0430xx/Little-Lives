const $ = selector =>
  document.querySelector(selector);

const esc = value =>
  String(value ?? '').replace(
    /[&<>"']/g,
    character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character])
  );

let token = localStorage.getItem('ll-token');

let user = JSON.parse(
  localStorage.getItem('ll-user') || 'null'
);

let home = null;

let homeId = localStorage.getItem('ll-home');

let tab = 'yard';
let selected = null;
let moving = null;
let moveDraft = null;

async function api(path, data) {
  const response = await fetch(
    '/api/' + path,
    {
      method: data ? 'POST' : 'GET',

      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token
      },

      body: data
        ? JSON.stringify(data)
        : undefined
    }
  );

  const result = await response.json();

  if (!response.ok) {
    throw Error(
      result.error || '連線失敗'
    );
  }

  return result;
}

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').style.display = 'block';

  setTimeout(() => {
    $('#toast').style.display = 'none';
  }, 3500);
}

function modal(html, onSubmit) {
  $('#modal-content').innerHTML = html;
  $('#modal').showModal();

  $('#modal-form').onsubmit =
    async event => {
      event.preventDefault();

      try {
        await onSubmit(
          new FormData(event.target)
        );
      } catch (error) {
        toast(error.message);
      }
    };

  $('#modal-content')
    .querySelectorAll('[data-close]')
    .forEach(button => {
      button.onclick = () =>
        $('#modal').close();
    });
}

function login(register = false) {
  modal(`
    <span class="eyebrow">
      WELCOME TO LITTLE LIVES
    </span>

    <h2>
      ${
        register
          ? '建立你的旅人帳號'
          : '歡迎回到小小人生'
      }
    </h2>

    <p>
      同一個帳號，
      在哪支手機都能回到自己的家。
    </p>

    <label>
      帳號

      <input
        name="account"
        required
        autocomplete="username"
        placeholder="3～24 位英數字或底線"
      >
    </label>

    ${
      register
        ? `
          <label>
            旅人暱稱

            <input
              name="name"
              required
              maxlength="20"
            >
          </label>
        `
        : ''
    }

    <label>
      密碼

      <input
        name="password"
        type="password"
        minlength="8"
        required
        autocomplete="${
          register
            ? 'new-password'
            : 'current-password'
        }"
      >
    </label>

    <button class="primary">
      ${register ? '註冊並出發' : '登入'}
    </button>

    <button type="button" id="switch">
      ${register ? '已有帳號' : '首次註冊'}
    </button>
  `, async form => {
    const result = await api(
      'login',
      {
        ...Object.fromEntries(form),
        register
      }
    );

    token = result.token;
    user = result.user;

    localStorage.setItem(
      'll-token',
      token
    );

    localStorage.setItem(
      'll-user',
      JSON.stringify(user)
    );

    $('#modal').close();
    $('#account').textContent = user.name;

    await chooseHome();
  });

  $('#switch').onclick = () => {
    $('#modal').close();
    login(!register);
  };
}

async function chooseHome() {
  const homes = await api('mine');

  modal(`
    <h2>回到你的溫暖小院</h2>

    <p>
      選擇家園，
      或邀請朋友一起建立新的日常。
    </p>

    ${
      homes.map(item => `
        <button
          type="button"
          data-home="${item.id}"
        >
          ${esc(item.name)} →
        </button>
      `).join('')
    }

    <hr>

    <label>
      家園名稱

      <input
        name="name"
        placeholder="暖陽小院"
      >
    </label>

    <label>
      家園密碼

      <input
        name="password"
        type="password"
        minlength="4"
        required
      >
    </label>

    <button class="primary">
      建立家園
    </button>

    <button type="button" id="join">
      使用邀請代碼加入
    </button>
  `, async form => {
    home = await api(
      'homes',
      Object.fromEntries(form)
    );

    saveHome();
    $('#modal').close();
    render();
  });

  document.querySelectorAll(
    '[data-home]'
  ).forEach(button => {
    button.onclick = async () => {
      homeId = button.dataset.home;

      await refresh();

      saveHome();
      $('#modal').close();
    };
  });

  $('#join').onclick = () => {
    $('#modal').close();

    modal(`
      <h2>加入朋友的小院</h2>

      <label>
        邀請代碼
        <input name="id" required>
      </label>

      <label>
        家園密碼

        <input
          name="password"
          type="password"
          required
        >
      </label>

      <button class="primary">
        加入家園
      </button>
    `, async form => {
      home = await api(
        'join?id=' +
          encodeURIComponent(
            form.get('id')
          ),
        {
          password: form.get('password')
        }
      );

      saveHome();
      $('#modal').close();
      render();
    });
  };
}

function saveHome() {
  homeId = home.id;

  localStorage.setItem(
    'll-home',
    homeId
  );
}

async function refresh() {
  if (!homeId) return;

  home = await api(
    'state?id=' + homeId
  );

  render();
}

async function action(type, extra = {}) {
  try {
    const result = await api(
      'action?id=' + homeId,
      {
        type,
        ...extra
      }
    );

    if (result.confirm) {
      modal(`
        <h2>
          今天已經打掃得很乾淨了 ✨
        </h2>

        <p>
          你的清掃任務已完成，
          還要繼續清潔嗎？
          繼續清潔仍可獲得 1 金幣，
          也可以留給朋友完成任務。
        </p>

        <button
          type="button"
          data-close
        >
          先留著
        </button>

        <button class="primary">
          繼續清潔
        </button>
      `, async () => {
        $('#modal').close();

        await action(type, {
          ...extra,
          confirm: true
        });
      });

      return;
    }

    home = result;
    render();
  } catch (error) {
    toast(error.message);
  }
}

function energy(pet) {
  const elapsed =
    Date.now() - (pet.updated || pet.fed);

  return Math.max(
    0,
    pet.energy - elapsed / 864000
  );
}

function render() {
  if (!home) return;

  $('#home-title').textContent =
    home.name + ' ☀';

  $('#account').textContent = user.name;

  $('#wallet').textContent =
    `🪙 ${home.coins[user.id]}　` +
    `🌾 ${home.food[user.id]}`;

  $('#members').textContent =
    `${home.members.length} / 5 位小院居民`;

  $('#create-pet').hidden =
    home.pets.some(pet =>
      pet.owner === user.id &&
      Date.now() - pet.fed < 432000000
    ) || tab !== 'yard';

  $('#care-progress').style.width =
    Math.min(100, home.care * 20) + '%';

  $('#care-text').textContent =
    `共同餵食 ${Math.min(home.care, 5)} / 5 次`;

  const tasks = [
    [
      '🧹',
      '清理院子',
      Math.min(
        home.clean[user.id] || 0,
        3
      ),
      3
    ],
    ['🌾', '餵食小夥伴', '—', 1],
    ['🤍', '溫柔摸摸', '—', 3],
    ['🎾', '陪寵物玩耍', '—', 2],
    ['🌱', '在農田播種', '—', 1],
    ['🥕', '收穫作物', '—', 1],
    [
      '🐾',
      '照顧朋友的寵物',
      '—',
      1
    ],
    [
      '🎁',
      '分享一份心意',
      '未開放',
      1
    ]
  ];

  $('#tasks').innerHTML =
    tasks.map(
      ([icon, name, value, target]) => `
        <div class="task">
          <span>${icon}</span>

          <div>
            <b>${name}</b>

            <small>
              ${
                value === '—'
                  ? '任務追蹤建置中'
                  : value === '未開放'
                    ? '功能籌備中'
                    : '清理可獲得 1 金幣'
              }
            </small>
          </div>

          <em>
            ${value} / ${target}
          </em>
        </div>
      `
    ).join('');

  $('#messages').innerHTML =
    home.chat.map(message => `
      <div>
        <b>${esc(message.name)}</b>
        　
        ${esc(message.text)}
      </div>
    `).join('') ||
    '歡迎回家！和朋友打聲招呼吧。';

  if (tab === 'yard') {
    $('#world').innerHTML =
      home.pets.map(pet => {
        const x =
          moving === pet.id && moveDraft
            ? moveDraft.x
            : pet.x;

        const y =
          moving === pet.id && moveDraft
            ? moveDraft.y
            : pet.y;

        const animal =
          Date.now() - pet.fed > 172800000
            ? '✉️'
            : pet.kind === 'cat'
              ? '🐈'
              : '🐕';

        return `
          <div
            class="house"
            style="left:${x}%;top:${y}%"
            data-house="${pet.id}"
          >
            ${
              moving === pet.id
                ? `
                  <div class="move-controls">
                    <button id="place">
                      ✓ 放置
                    </button>

                    <button id="cancel-move">
                      取消
                    </button>
                  </div>
                `
                : ''
            }

            <div class="roof"></div>

            <div class="hut">
              <b>
                ${esc(pet.name)}的家
              </b>

              <div class="door"></div>
            </div>

            <div
              class="animal"
              data-pet="${pet.id}"
            >
              ${animal}
            </div>

            ${
              pet.waste.map(
                (waste, index) => `
                  <button
                    class="waste"
                    data-p="${pet.id}"
                    data-w="${waste}"
                    aria-label="清理${
                      index % 2
                        ? '尿尿'
                        : '大便'
                    }"
                  >
                    ${
                      index % 2
                        ? '💧'
                        : '💩'
                    }
                  </button>
                `
              ).join('')
            }
          </div>
        `;
      }).join('') +
      home.pets.map(
        (pet, index) => `
          <span
            class="toy"
            style="left:${20 + index * 13}%"
          >
            ${pet.toy}
          </span>
        `
      ).join('');
  } else if (tab === 'farm') {
    $('#world').innerHTML =
      home.farm
        ? `
          <div class="plots">
            ${
              home.plots.map(
                (plot, index) => `
                  <button
                    class="plot"
                    data-plot="${index}"
                  >
                    ${
                      plot
                        ? plot.crop
                        : '＋'
                    }

                    <small>
                      ${
                        plot
                          ? Date.now() - plot.at >= 7200000
                            ? '可以收成'
                            : '正在慢慢長大'
                          : '播種 · 3 金幣'
                      }
                    </small>
                  </button>
                `
              ).join('')
            }
          </div>
        `
        : `
          <div class="scene-create card">
            🌱 完成 5 次家園餵食，
            解鎖農田。
          </div>
        `;
  } else {
    $('#world').innerHTML = `
      <div class="scene-create card">
        🎣 池塘籌備中，敬請期待。
      </div>
    `;
  }

  document.querySelectorAll(
    '[data-pet]'
  ).forEach(element => {
    element.onclick = event => {
      event.stopPropagation();
      selected = element.dataset.pet;
      petPanel();
    };
  });

  document.querySelectorAll(
    '[data-house]'
  ).forEach(element => {
    element.onclick = () => {
      selected = element.dataset.house;
      petPanel();
    };
  });

  document.querySelectorAll(
    '[data-w]'
  ).forEach(element => {
    element.onclick = event => {
      event.stopPropagation();

      action('clean', {
        pet: element.dataset.p,
        waste: element.dataset.w
      });
    };
  });

  document.querySelectorAll(
    '[data-plot]'
  ).forEach(element => {
    element.onclick = () => {
      const index =
        Number(element.dataset.plot);

      action(
        home.plots[index]
          ? 'harvest'
          : 'plant',
        { index }
      );
    };
  });

  if ($('#place')) {
    $('#place').onclick = event => {
      event.stopPropagation();

      const draft = moveDraft;
      const petId = moving;

      moving = null;
      moveDraft = null;

      if (draft) {
        action('move', {
          pet: petId,
          ...draft
        });
      } else {
        render();
      }
    };
  }

  if ($('#cancel-move')) {
    $('#cancel-move').onclick =
      event => {
        event.stopPropagation();

        moving = null;
        moveDraft = null;

        render();
      };
  }

  petPanel();
}

function petPanel() {
  const pet = home?.pets.find(
    item => item.id === selected
  );

  if (!pet) return;

  const absent =
    Date.now() - pet.fed >= 172800000;

  $('#pet-panel').innerHTML = `
    <div style="width:100%">
      <h3>
        ${pet.kind === 'cat' ? '🐈' : '🐕'}

        ${esc(pet.name)}

        <small>
          ${esc(pet.breed)}
          ·
          ${esc(pet.zodiac)}
          ·
          Lv.${1 + Math.floor(pet.xp / 100)}
        </small>
      </h3>

      <div class="stats">
        <span>
          🌾 體力
          ${Math.round(energy(pet))}/100
        </span>

        <span>
          ♡ 心情 ${pet.mood}/100
        </span>

        <span>
          ✧ 經驗 ${pet.xp % 100}/100
        </span>

        ${
          absent
            ? '<span>✉ 已離家</span>'
            : Date.now() - pet.fed >= 86400000
              ? '<span>🩹 生病了</span>'
              : ''
        }
      </div>

      <div class="pet-actions">
        ${
          absent
            ? `
              <button data-act="recover">
                🔎 尋找線索
                （${pet.search || 0}/3）
              </button>
            `
            : `
              <button data-act="feed">
                🌾 餵食
              </button>
            `
        }

        <button data-act="stroke">
          ♡ 摸摸
        </button>

        <button data-act="play">
          🎾 玩耍
        </button>

        ${
          pet.owner === user.id
            ? `
              <button id="move">
                ↔ 移動小屋
              </button>
            `
            : ''
        }
      </div>
    </div>
  `;

  document.querySelectorAll(
    '[data-act]'
  ).forEach(button => {
    button.onclick = () => {
      action(button.dataset.act, {
        pet: pet.id
      });
    };
  });

  if ($('#move')) {
    $('#move').onclick = () => {
      moving = pet.id;

      moveDraft = {
        x: pet.x,
        y: pet.y
      };

      toast(
        '點選院子的位置移動小屋，再按放置'
      );

      render();
    };
  }
}

$('#scene').onclick = event => {
  if (
    !moving ||
    event.target.closest('button') ||
    event.target.closest('.house')
  ) {
    return;
  }

  const rectangle =
    $('#scene').getBoundingClientRect();

  moveDraft = {
    x: Math.max(
      4,
      Math.min(
        86,
        (
          event.clientX - rectangle.left
        ) / rectangle.width * 100
      )
    ),

    y: Math.max(
      8,
      Math.min(
        65,
        (
          event.clientY - rectangle.top
        ) / rectangle.height * 100
      )
    )
  };

  render();
};

$('#create-pet').onclick = () => {
  if (!home) {
    return toast(
      '請先登入並建立家園'
    );
  }

  const zodiacOptions = [
    '牡羊',
    '金牛',
    '雙子',
    '巨蟹',
    '獅子',
    '處女',
    '天秤',
    '天蠍',
    '射手',
    '摩羯',
    '水瓶',
    '雙魚'
  ].map(name =>
    `<option>${name}座</option>`
  ).join('');

  modal(`
    <h2>迎接新的小夥伴 🐾</h2>

    <label>
      名字

      <input
        name="name"
        required
        maxlength="12"
        placeholder="糯米"
      >
    </label>

    <label>
      動物

      <select name="kind">
        <option value="dog">
          狗狗
        </option>

        <option value="cat">
          貓咪
        </option>
      </select>
    </label>

    <label>
      品種

      <select name="breed">
        <option>米克斯</option>
        <option>貴賓</option>
        <option>梗犬</option>
        <option>柴犬</option>
        <option>柯基</option>
        <option>英國短毛</option>
        <option>布偶</option>
        <option>暹羅</option>
      </select>
    </label>

    <label>
      星座

      <select name="zodiac">
        ${zodiacOptions}
      </select>
    </label>

    <label>
      毛色

      <input
        type="color"
        name="color"
        value="#d5a76d"
      >
    </label>

    <p>
      精細外觀編輯與星座動作後續開放。
    </p>

    <button class="primary">
      一起開始生活
    </button>

    <button
      type="button"
      data-close
    >
      再想一下
    </button>
  `, async form => {
    await action(
      'pet',
      Object.fromEntries(form)
    );

    $('#modal').close();
  });
};

$('#buy').onclick = () =>
  home
    ? action('buy')
    : login();

$('#unlock').onclick = () =>
  home
    ? action('unlock')
    : login();

$('#invite').onclick = async () => {
  if (!home) {
    return login();
  }

  const text =
    `小小人生｜${home.name} ` +
    `邀請代碼：${home.id}，` +
    '請向屋主取得密碼。';

  try {
    await navigator.clipboard.writeText(
      text
    );

    toast(
      '邀請代碼已複製：' + home.id
    );
  } catch {
    toast(text);
  }
};

$('#account').onclick = () => {
  if (!user) {
    return login();
  }

  modal(`
    <h2>
      ${esc(user.name)} 的旅人手帳
    </h2>

    <p>
      換手機時使用原帳號密碼登入即可。
    </p>

    <button type="button" id="homes">
      切換／建立家園
    </button>

    <button type="button" id="logout">
      登出
    </button>

    <button type="button" data-close>
      返回
    </button>
  `, () => {});

  $('#homes').onclick = () => {
    $('#modal').close();
    chooseHome();
  };

  $('#logout').onclick = () => {
    localStorage.removeItem(
      'll-token'
    );

    localStorage.removeItem(
      'll-user'
    );

    location.reload();
  };
};

$('#chat').onsubmit = event => {
  event.preventDefault();

  if (!home) {
    return login();
  }

  const input =
    event.target.elements.text;

  if (input.value.trim()) {
    action('chat', {
      text: input.value
    });

    input.value = '';
  }
};

document.querySelectorAll(
  '[data-tab]'
).forEach(button => {
  button.onclick = () => {
    tab = button.dataset.tab;

    document.querySelectorAll(
      '[data-tab]'
    ).forEach(item => {
      item.classList.toggle(
        'active',
        item === button
      );
    });

    if (home) {
      render();
    }
  };
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(
    '/sw.js'
  );
}

(async () => {
  try {
    if (token) {
      $('#account').textContent =
        user.name;

      if (homeId) {
        await refresh();
      } else {
        await chooseHome();
      }
    } else {
      login();
    }
  } catch (error) {
    toast(error.message);
    login();
  }
})();

setInterval(() => {
  if (
    homeId &&
    token &&
    !moving
  ) {
    refresh().catch(() => {});
  }
}, 4000);
