// 브리핑 초안 규칙(docs/assets/js/briefing.js) 점검: node --test tests/*.test.mjs
// 6개 장면 × 화물 4종 × 문서 4종이 빈칸 없이 만들어지고, 숫자가 엔진 출력·화면 판단과 어긋나지 않는지 본다.
// 쓰는 사람은 중소 포워더 담당자다: 화주 안내 · 운송사 요청 · 사내 보고 · 선사·터미널 협의.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  DOC_KINDS, buildDoc, docToText, docToHTML, shipperDoc, driverDoc, internalDoc, portDoc, josa, cargoFacts, DEMO_TAG, driverHeadline,
  DEFAULT_SENDER, DEFAULT_CARRIER, CARGO_META,
} from "../docs/assets/js/briefing.js";
import { classifyCargo } from "../docs/assets/js/derive.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "data");
const PRE = JSON.parse(readFileSync(join(root, "precomputed.json"), "utf8"));
const R = PRE.runs;
const URL0 = "https://example.org/driver.html";

test("조사: 받침에 맞춰 고른다", () => {
  assert.equal(josa("출발", ["으로", "로"]), "출발로");
  assert.equal(josa("도착", ["으로", "로"]), "도착으로");
  assert.equal(josa("16:00", ["으로", "로"]), "16:00으로");
  assert.equal(josa("○○운송", ["은", "는"]), "○○운송은");
  assert.equal(josa("○○포워딩", ["은", "는"]), "○○포워딩은");
  assert.equal(josa("게이트·도로(양산·울산)", ["이", "가"]), "게이트·도로(양산·울산)가");
  assert.equal(josa("시스템 오류", ["으로", "로"]), "시스템 오류로");
});

test("문서 종류: 주소용 key는 그대로, 이름과 보내는 사람은 포워더 기준", () => {
  assert.deepEqual(DOC_KINDS.map((k) => k.key), ["shipper", "driver", "internal", "port"]);
  assert.deepEqual(DOC_KINDS.map((k) => k.label), ["화주 안내", "운송사 요청", "사내 보고", "선사·터미널 협의"]);
  assert.deepEqual(DOC_KINDS.map((k) => k.scope), ["cargo", "cargo", "day", "day"]);
  assert.equal(DEFAULT_SENDER.company, "○○포워딩");
  assert.equal(DEFAULT_CARRIER, "○○운송 배차팀");
  // 포워더가 맡은 화주는 화물마다 다르고, 보내는 포워더 자신과 겹치지 않는다
  const shippers = Object.values(CARGO_META).map((m) => m.shipper);
  assert.equal(new Set(shippers).size, shippers.length);
  for (const s of shippers) assert.ok(!s.includes(DEFAULT_SENDER.company) && !/포워딩/.test(s), s);
});

test("모든 장면·화물·문서가 빈칸 없이 만들어진다", () => {
  let reviews = 0;
  for (const [s, run] of Object.entries(R)) {
    for (const key of run.cargo_order) {
      for (const k of DOC_KINDS) {
        for (const applied of [false, true]) {
          const doc = buildDoc(k.key, run, key, { applied: { [key]: applied }, driverUrl: URL0 });
          const text = docToText(doc);
          const html = docToHTML(doc);
          const at = `${s}/${key}/${k.key}/${applied}`;
          assert.ok(doc.title.length > 4, `${at}: 제목`);
          assert.doesNotMatch(text, /undefined|NaN|null|\[object/, `${at}: ${text}`);
          assert.doesNotMatch(html, /undefined|NaN/, `${at}: html`);
          assert.ok(text.includes(DEMO_TAG), `${at}: 가상 데이터 표시`);
          // 운송사 배차 담당 시절 말투가 남지 않는다
          assert.doesNotMatch(text, /배차 담당|배차 지시|배차실|배차를 R-Delay|차량 1호 기사님|운송사 쪽 영향/, `${at}: ${text}`);
          assert.ok(text.includes(`${DEFAULT_SENDER.company} ${DEFAULT_SENDER.name}`), `${at}: 보내는 사람`);
          if (k.key === "driver") {
            // 운송사 요청: 받는 곳, 마감 위험, 회신 요청이 늘 있다
            assert.match(text, /^\[운송 요청\] /, at);
            assert.match(text, /받는 사람: ○○운송 배차팀\n/, at);
            assert.match(text, /\n- 마감을 놓칠 가능성: \S/, at);
            assert.match(text, /■ 회신 부탁드립니다\n• /, at);
            // 기사님 링크: 변경 검토 중(권장 변경을 아직 적용하지 않음)에는 보내지 않는다(기사님 화면이 아직 지금 계획 시각을 보여 줌).
            // 그 밖에는(적용함·변경 없음) 기사님께 전할 말과 링크가 늘 있다
            const f = cargoFacts(run, key, applied);
            if (!f.changed && f.cls === "change" && f.choice) {
              reviews += 1;
              assert.ok(!text.includes(URL0) && !text.includes("기사님 화면(몇 시에"), `${at}: ${text}`);
              assert.ok(text.includes("차량이 정해지면 기사님 화면 링크를 담아 다시 요청드리겠습니다. "), `${at}: ${text}`);
            } else {
              assert.ok(text.includes(`■ 기사님께 전해 주십시오`) && text.includes(`기사님 화면(몇 시에 가면 덜 기다리는지): ${URL0}`), `${at}: ${text}`);
              assert.ok(!text.includes("차량이 정해지면"), `${at}: ${text}`);
            }
          }
        }
      }
    }
  }
  assert.ok(reviews > 0, "변경 검토 상태가 하나 이상 있어야 이 확인이 의미 있다");
});

test("장비 고장 · 울산 수출: 일정 변경 안내와 운송사 요청(검토 → 변경)", () => {
  const run = R.terminal_failure;
  // 화주 안내(변경 적용 뒤): 바뀐 시각을 확정해서 알린다
  const sh = docToText(shipperDoc(run, "ulsan_export", { applied: true }));
  assert.match(sh, /\[일정 변경 안내\]/);
  assert.match(sh, /출발 시각을 20:00에서 16:00으로 앞당깁니다/);
  assert.match(sh, /마감을 놓칠 가능성: 거의 확실 → 1% 미만/);
  assert.match(sh, /18:00~23:30 수출 반입을 막는다고 공지/);
  assert.match(sh, /- 바뀐 출발 시각: 16:00 \(기존 20:00\)\n/);
  assert.match(sh, /차량은 16:00에 출발합니다\./);
  // 화주 안내(적용 전): 운송사와 차량을 조율 중이라고 쓰고, 차량 출발 시각을 약속하지 않는다
  const pend = docToText(shipperDoc(run, "ulsan_export"));
  assert.match(pend, /^\[일정 변경 예정 안내\] 울산 부품 수출 출발 20:00 → 16:00\n/);
  assert.match(pend, /출발 시각을 20:00에서 16:00으로 앞당기려고 협력 운송사와 차량을 조율하고 있습니다\. 확정되면 바로 알려 드리겠습니다\./);
  assert.match(pend, /- 바꿀 출발 시각\(조율 중\): 16:00 \(기존 20:00\)\n/);
  assert.doesNotMatch(pend, /앞당깁니다|바뀐 출발 시각|차량은 \d\d:\d\d에 출발합니다/);
  // 적용 전: 추천 시각에 차량을 낼 수 있는지 먼저 묻는다
  const before = docToText(driverDoc(run, "ulsan_export", { driverUrl: URL0 }));
  assert.match(before, /^\[운송 요청\] 울산 부품 수출 · 변경 검토\n/);
  assert.match(before, /변경 검토 중: 출발 16:00 권장 — 아직 확정 전입니다/);
  assert.match(before, /○○운송 배차팀 담당자님, ○○포워딩 수출입 담당 ○○○입니다\. 울산 부품 수출 화물의 출발 시각을 16:00으로 바꾸는 것을 검토하고 있습니다\./);
  assert.match(before, /터미널이 18:00~23:30 수출 반입을 막는다고 공지해 내일 00:00 선적 반입 마감을 지키기 위해서입니다\./);
  assert.match(before, /마감을 놓칠 가능성: 지금 계획 거의 확실 → 바꾸면 1% 미만/);
  assert.match(before, /• 16:00 출발 차량을 낼 수 있는지 알려 주십시오\./);
  assert.match(before, /출발: 20:00/);
  // 검토 중에는 기사님 링크를 보내지 않는다(기사님 화면은 아직 20:00 계획을 보여 줌). 반입 금지 공지는 그대로 전한다
  assert.ok(!before.includes(URL0), before);
  assert.match(before, /■ 기사님께 전해 주십시오\n• 18:00~23:30 수출 반입 금지\(터미널 공지\) — 18:00 전에 반입해야 합니다\.\n\n/);
  assert.match(before, /\n차량이 정해지면 기사님 화면 링크를 담아 다시 요청드리겠습니다\. \d\d:\d\d에 다시 확인해 바뀌면 바로 알려 드리겠습니다\.\n/);
  // 적용 뒤: 바꾼 시각을 요청하고 이유·마감 위험·기사님 링크를 함께 보낸다
  const after = docToText(driverDoc(run, "ulsan_export", { applied: true, driverUrl: URL0 }));
  assert.match(after, /^\[운송 요청\] 울산 부품 수출 · 출발 시각 변경\n/);
  assert.match(after, /울산 부품 수출 화물의 출발 시각을 20:00에서 16:00으로 바꿔 주시기 바랍니다\./);
  assert.match(after, /지키기 위해서입니다\./);
  assert.match(after, /시간 변경: 출발 20:00 → 16:00/);
  assert.match(after, /출발: 16:00/);
  assert.match(after, /마감을 놓칠 가능성: 거의 확실 → 1% 미만/);
  assert.match(after, /• 18:00~23:30 수출 반입 금지\(터미널 공지\) — 18:00 전에 반입해야 합니다\./);
  assert.ok(after.includes(`• 기사님 화면(몇 시에 가면 덜 기다리는지): ${URL0}\n`), after);
  assert.doesNotMatch(after, /차량이 정해지면/);
  assert.match(after, /• 배정 차량 번호와 기사님 연락처를 알려 주십시오\./);
  assert.match(after, /문의: ○○포워딩 수출입 담당 ○○○ \(010-0000-0000\)/);
  assert.doesNotMatch(after, /변경 검토 중/);
});

test("화주 사전 안내: 놓칠 확률은 화면 판단과 같은 값, 차량은 협력 운송사에 · 우선 하역은 선사를 통해", () => {
  const run = R.terminal_failure;
  for (const key of ["import_factory", "ulsan_parts", "sea_air"]) {
    const k = classifyCargo(run, key);
    assert.equal(k.cls, "notify");
    assert.equal(k.least.is_plan, true, `${key}: 운송사 요청은 지금 계획 시각으로 나간다`);
    const t = docToText(shipperDoc(run, key));
    const pct = `약 ${Math.round(k.least.p_fail * 100)}%`;
    assert.match(t, /\[사전 안내\]/);
    assert.ok(t.includes(pct), `${key}: ${t}`);
    assert.match(t, /협력 운송사에 터미널 \d\d:\d\d 도착으로 차량을 요청해 두었습니다/);
    assert.match(t, /선사를 통해 터미널에 우선 하역을 요청/);
    // 같은 화물의 운송사 요청도 같은 마감 위험을 적는다
    const d = docToText(driverDoc(run, key, { driverUrl: URL0 }));
    assert.ok(d.includes(`마감을 놓칠 가능성: ${pct}`), `${key}: ${d}`);
    assert.match(d, /• 터미널이 혼잡합니다\. 기사님이 터미널에 도착하면 도착 시각을 알려 주십시오\./);
  }
  // Sea&Air: 항공편은 포워더가 확인하고, 화주에게는 납기를 묻는다
  const sa = docToText(shipperDoc(run, "sea_air"));
  assert.match(sa, /받는 사람: ○○무역 물류팀/);
  assert.match(sa, /• 다음 항공편 좌석을 항공사에 미리 확인해 두겠습니다\./);
  assert.match(sa, /다음 항공편으로 넘어가도 괜찮은지 도착지 납기를 확인해 주십시오\./);
});

test("사내 보고: 화물 4건 표와 변경 적용 여부", () => {
  const run = R.terminal_failure;
  const d0 = internalDoc(run);
  const table = d0.blocks.find((b) => b.table).table;
  assert.equal(table.rows.length, 4);
  assert.match(docToText(d0), /출발 20:00 → 16:00 \(적용 필요\)/);
  const d1 = internalDoc(run, { applied: { ulsan_export: true } });
  assert.match(docToText(d1), /출발 20:00 → 16:00 \(적용함\)/);
  assert.match(docToText(d1), /줄어드는 예상 손실: 약 250만 원/);
  assert.match(docToText(d0), /작성: ○○포워딩 수출입 담당 ○○○/);
  assert.match(docToText(d0), /선사·터미널 공지가 바뀌면 즉시 다시 봅니다/);
});

test("선사·터미널 협의: 번짐을 멈추는 대응을 반사실로 고르고, 포워더 입장에서 요청한다", () => {
  const tf = docToText(portDoc(R.terminal_failure));
  assert.match(tf, /처리능력 복구만으로 번짐 지수가 1 아래\(0\.72\)/);
  assert.match(docToText(portDoc(R.typhoon_diversion)), /물량 분산만으로 번짐 지수가 1 아래/);
  assert.match(docToText(portDoc(R.base)), /평소 운영을 유지하면 됩니다/);
  assert.match(docToText(portDoc(R.epidemic)), /막힌 곳의 적체 해소가 우선/);
  assert.match(tf, /책임 소재 판단에 쓰지 않습니다/);
  assert.match(tf, /받는 사람: 선사·터미널 운영사 담당자\(참조: 부산항만공사\)/);
  assert.match(tf, /○○포워딩은 화주들의 부산신항 수출입·Sea&Air 화물을 맡아 R-Delay로 관리하는 포워더입니다\./);
  assert.match(tf, /■ 3\. 저희가 맡은 화물 영향/);
  // 우선 하역 요청: 엔진의 승인 시 확률 그대로(펼친 카드의 「승인되면 19% · 안 되면 44%」와 같은 값)
  assert.match(tf, /• 양산 공장 원자재: 우선 하역 요청 — 받아들여지면 놓칠 확률 19%\(지금 44%\)/);
  for (const key of ["import_factory", "ulsan_parts", "sea_air"]) {
    const f = cargoFacts(R.terminal_failure, key);
    assert.ok(tf.includes(`받아들여지면 놓칠 확률 ${Math.round(f.pr.p_if_approved * 100)}%(지금 ${Math.round(f.best.p_fail * 100)}%)`), key);
  }
  // 위험한 화물이 없으면 우선 하역은 요청하지 않고 일정 공유만 부탁한다
  const base = docToText(portDoc(R.base));
  assert.doesNotMatch(base, /우선 하역 요청 —/);
  assert.match(base, /■ 4\. 요청 사항\n• 선석·하역 일정이나 반입 제한이 바뀌면 바로 알려 주십시오\./);
});

test("운송사 요청: 수소 트럭으로 바꾸면 시각과 차량을 함께, 차량만 바꾸면 차량 변경으로", () => {
  const h = docToText(driverDoc(R.h2_trucks, "import_factory", { applied: true, driverUrl: URL0 }));
  assert.match(h, /^\[운송 요청\] 양산 공장 원자재 · 도착 시각 변경\n/);
  assert.match(h, /양산 공장 원자재 화물의 터미널 도착 시각을 20:00에서 21:30으로 바꿔 주시기 바랍니다\. 차량은 수소 트럭으로 부탁드립니다\./);
  assert.match(h, /터미널 도착: 21:30 · 수소 트럭/);
  assert.match(h, /※ 수소 트럭은 20:15부터 터미널 도착 가능합니다/);
  assert.doesNotMatch(h, /지키기 위해서입니다/, "바꿔도 됨(선택) 화물은 마감 때문이라고 쓰지 않는다");
  // 같은 시각의 수소 트럭으로만 바꾸는 경우(재현용으로 장면을 고친다)
  const run = structuredClone(R.h2_trucks);
  const c = run.cargo.import_factory;
  Object.assign(c.candidates.find((x) => x.label === "도착 20:00 · 수소"), { feasible: true, status: "추천", reasons: [] });
  c.decision = { ...c.decision, choice: "도착 20:00 · 수소" };
  const v = docToText(driverDoc(run, "import_factory", { applied: true, driverUrl: URL0 }));
  assert.match(v, /^\[운송 요청\] 양산 공장 원자재 · 차량 변경\n/);
  assert.match(v, /양산 공장 원자재 화물의 차량을 수소 트럭으로 바꿔 주시기 바랍니다\./);
  assert.match(v, /차량 변경: 디젤 → 수소 트럭/);
  assert.doesNotMatch(v, /시간 변경:/);
});

test("기사님 화면 한 줄: 수입은 반출 뒤 도착, 수출은 반입 금지 전", () => {
  const run = R.terminal_failure;
  assert.equal(driverHeadline(run, "import_factory").big, "21:40 이후 도착");
  assert.equal(driverHeadline(run, "ulsan_export", true).big, "18:00 전 반입");
  assert.equal(cargoFacts(run, "ulsan_export", true).changed, true);
});
