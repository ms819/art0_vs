/**
 * @typedef {'red'|'blue'|'green'|'white'|'yellow'|'purple'} BspoColor
 * @typedef {{ lv: 1|2|3|4|5, core: number, bp: number }} LevelInfo
 *
 * @typedef {Object} Card
 * @property {string} id
 * @property {string} name
 * @property {number} cost
 * @property {Record<BspoColor, number>} reduction
 * @property {BspoColor} color
 * @property {number} symbolCount
 * @property {BspoColor|string} symbolColor
 * @property {LevelInfo[]} levels
 * @property {'spirit'|'nexus'|'magic'} type
 * @property {string} img
 */

export const cards = [
  // ======== Spirits ========
  {
    id: 'A-001',
    name: 'アイゼン',
    cost: 5,
    reduction: { red: 3, blue: 0, green: 0, white: 0, yellow: 0, purple: 0 },
    color: 'red',
    symbolCount: 1,
    symbolColor: 'red',
    levels: [
      { lv: 1, core: 1, bp: 3000 },
      { lv: 2, core: 3, bp: 5000 },
      { lv: 3, core: 5, bp: 6000 },
    ],
    type: 'spirit',
    img: '/images/aizen.png',
  },
  {
    id: 'A-002',
    name: 'ファイザード',
    cost: 0,
    reduction: { red: 0, blue: 0, green: 0, white: 0, yellow: 0, purple: 0 },
    color: 'red',
    symbolCount: 1,
    symbolColor: 'red',
    levels: [
      { lv: 1, core: 1, bp: 1000 },
      { lv: 2, core: 3, bp: 3000 },
      { lv: 3, core: 5, bp: 4000 },
    ],
    type: 'spirit',
    img: '/images/faizard.png',
  },
  {
    id: 'A-003',
    name: 'ナイト',
    cost: 4,
    reduction: { red: 2, blue: 0, green: 0, white: 0, yellow: 0, purple: 0 },
    color: 'red',
    symbolCount: 1,
    symbolColor: 'red',
    levels: [
      { lv: 1, core: 1, bp: 2000 },
      { lv: 2, core: 3, bp: 5000 },
    ],
    type: 'spirit',
    img: '/images/nite.png',
  },
  {
    id: 'A-004',
    name: 'リューマン',
    cost: 2,
    reduction: { red: 2, blue: 0, green: 0, white: 0, yellow: 0, purple: 0 },
    color: 'red',
    symbolCount: 1,
    symbolColor: 'red',
    levels: [
      { lv: 1, core: 1, bp: 1000 },
      { lv: 2, core: 5, bp: 5000 },
    ],
    type: 'spirit',
    img: '/images/ryu-man.png',
  },
  {
    id: 'A-005',
    name: 'ウルフ',
    cost: 3,
    reduction: { red: 2, blue: 0, green: 2, white: 0, yellow: 0, purple: 0 },
    color: 'red',
    symbolCount: 1,
    symbolColor: 'red',
    levels: [
      { lv: 1, core: 1, bp: 3000 },
      { lv: 2, core: 3, bp: 5000 },
      { lv: 3, core: 4, bp: 6000 },
    ],
    type: 'spirit',
    img: '/images/uruhu.png',
  },
  {
    id: 'A-006',
    name: 'ARジークF',
    cost: 6,
    reduction: { red: 3, blue: 0, green: 0, white: 1, yellow: 0, purple: 0 },
    color: 'red',
    symbolCount: 1,
    symbolColor: 'arutimetto',
    levels: [
      { lv: 3, core: 1, bp: 10000 },
      { lv: 4, core: 3, bp: 14000 },
      { lv: 5, core: 5, bp: 20000 },
    ],
    type: 'arutimetto',
    img: '/images/ji-ku.png',
  },
  {
    id: 'A-007',
    name: 'ARジークV',
    cost: 8,
    reduction: { red: 4, blue: 0, green: 0, white: 0, yellow: 0, purple: 0 },
    color: 'red',
    symbolCount: 1,
    symbolColor: 'arutimetto',
    levels: [
      { lv: 3, core: 1, bp: 15000 },
      { lv: 4, core: 3, bp: 20000 },
      { lv: 5, core: 5, bp: 30000 },
    ],
    type: 'arutimetto',
    img: '/images/art_j.jpeg',
  },

  // ======== Magic ========
  {
    id: 'A-008',
    name: 'ダブルドロー',
    cost: 4,
    reduction: { red: 2, blue: 0, green: 0, white: 0, yellow: 0, purple: 0 },
    color: 'red',
    symbolCount: 0,
    symbolColor: 'red',
    levels: [],
    type: 'magic',
    img: '/images/double.png',
  },
  {
    id: 'A-009',
    name: 'シャイニングフレイム',
    cost: 7,
    reduction: { red: 3, blue: 0, green: 0, white: 0, yellow: 0, purple: 0 },
    color: 'red',
    symbolCount: 0,
    symbolColor: 'red',
    levels: [],
    type: 'magic',
    img: '/images/hureimu.png',
  },
  {
    id: 'A-010',
    name: 'フレイムテンペスト',
    cost: 7,
    reduction: { red: 3, blue: 0, green: 0, white: 0, yellow: 0, purple: 0 },
    color: 'red',
    symbolCount: 0,
    symbolColor: 'red',
    levels: [],
    type: 'magic',
    img: '/images/tennpest.png',
  },

  // ======== Nexus ========
  {
    id: 'A-011',
    name: '狩る者の集落',
    cost: 3,
    reduction: { red: 2, blue: 0, green: 0, white: 0, yellow: 0, purple: 0 },
    color: 'red',
    symbolCount: 1,
    symbolColor: 'red',
    levels: [
      { lv: 1, core: 0, bp: 0 },
      { lv: 2, core: 2, bp: 0 },
    ],
    type: 'nexus',
    img: '/images/syuuraku.png',
  },
];