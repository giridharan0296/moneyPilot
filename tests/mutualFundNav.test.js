import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyFundNavs, findFundNav, isFundHolding, optionKey, parseAmfiNavs, planKey } from '../lib/mutualFundNav.js';

// Same layout as AMFI's NAVAll.txt, including a category heading line.
const FEED = [
  'Open Ended Schemes(Equity Scheme - ELSS)',
  'Kotak Mutual Fund',
  '103339;INF174K01369;-;Kotak ELSS Tax Saver Fund;Regular Plan;Growth;113.832;06-Oct-2026',
  '119773;INF174K01LI3;-;Kotak ELSS Tax Saver Fund;Direct Plan;Growth;135.194;06-Oct-2026',
  '119772;INF174K01LJ1;-;Kotak ELSS Tax Saver Fund;Direct Plan;Payout of Income Distribution cum capital withdrawal option;56.632;06-Oct-2026',
  '999001;INF000XX0001;-;Some Fund;Direct Plan;Growth;N.A.;06-Oct-2026',
].join('\r\n');

const navs = parseAmfiNavs(FEED);

describe('AMFI NAV feed', () => {
  it('reads plan and option, and skips headings and rows with no NAV', () => {
    assert.equal(navs.byName.get('kotak elss tax saver fund').length, 3);
    assert.equal(navs.byIsin.get('INF174K01LI3').nav, 135.194);
    assert.equal(navs.byIsin.has('INF000XX0001'), false);
  });

  it('maps plan and option labels to keys', () => {
    assert.equal(planKey('Direct Plan'), 'direct');
    assert.equal(planKey('Regular Plan'), 'regular');
    assert.equal(optionKey('Growth Option'), 'growth');
    assert.equal(optionKey('IDCW Option'), 'idcw');
    assert.equal(optionKey('Payout of Income Distribution cum capital withdrawal option'), 'idcw');
  });
});

describe('matching a fund holding to a scheme', () => {
  it('matches by ISIN when the import carried one', () => {
    const s = findFundNav({ symbol: 'anything', isin: 'INF174K01LI3' }, navs);
    assert.equal(s.nav, 135.194);
  });

  it('matches by name + plan + option when there is no ISIN, and picks the Direct plan', () => {
    const s = findFundNav({ symbol: 'Kotak ELSS Tax Saver Fund', plan: 'Direct', option: 'Growth' }, navs);
    assert.equal(s.nav, 135.194);
  });

  it('never matches on name alone: without a plan, the Direct/Regular choice is a guess', () => {
    assert.equal(findFundNav({ symbol: 'Kotak ELSS Tax Saver Fund' }, navs), null);
  });

  it('refuses an ambiguous match (two IDCW schemes under one name)', () => {
    const r = findFundNav({ symbol: 'Kotak ELSS Tax Saver Fund', plan: 'Direct', option: 'IDCW' }, navs);
    assert.equal(r, navs.byIsin.get('INF174K01LJ1'));
    const two = parseAmfiNavs([
      '1;INF1;-;Dup Fund;Direct Plan;IDCW Option;10;06-Oct-2026',
      '2;INF2;-;Dup Fund;Direct Plan;Payout of Income Distribution option;11;06-Oct-2026',
    ].join('\n'));
    assert.equal(findFundNav({ symbol: 'Dup Fund', plan: 'Direct', option: 'IDCW' }, two), null);
  });

  it('identifies fund holdings from the broker or the plan/option columns', () => {
    assert.equal(isFundHolding({ broker: 'mf' }), true);
    assert.equal(isFundHolding({ plan: 'Direct', option: 'Growth' }), true);
    assert.equal(isFundHolding({ symbol: 'ITBEES', isin: 'INF204KB15V2' }), false);
  });
});

describe('applying NAVs to holdings', () => {
  it('re-prices a fund at units × NAV and recomputes P&L from the invested amount', () => {
    const out = applyFundNavs([{
      symbol: 'Kotak ELSS Tax Saver Fund', plan: 'Direct', option: 'Growth',
      quantity: 100, investedValue: 10000, currentValue: 0, currentPrice: 0,
    }], navs, '2026-10-06T00:00:00.000Z');
    const h = out.holdings[0];
    assert.equal(out.updated, 1);
    assert.equal(h.currentPrice, 135.194);
    assert.ok(Math.abs(h.currentValue - 13519.4) < 1e-6);
    assert.ok(Math.abs(h.pnl - 3519.4) < 1e-6);
    assert.equal(h.priceSource, 'amfi');
  });

  it('leaves Yahoo-priced holdings alone and reports fund holdings it could not match', () => {
    const out = applyFundNavs([
      { symbol: 'ITC', priceSource: 'live', currentValue: 500 },
      { symbol: 'Unknown Fund', broker: 'mf', quantity: 1, investedValue: 1 },
    ], navs);
    assert.equal(out.holdings[0].currentValue, 500);
    assert.deepEqual(out.unresolved, ['Unknown Fund']);
    assert.equal(out.updated, 0);
  });
});
