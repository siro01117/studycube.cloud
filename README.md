This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## 환경변수

`.env.example` 참고. 로컬은 `.env.local`, 배포는 Vercel 프로젝트 설정(Settings → Environment Variables)에 넣는다.

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `DATABASE_URL` | 배포 필수 | 없으면 로컬 PGlite로 폴백 |
| `SESSION_SECRET` | 권장 | 없으면 접속 문자열에서 파생 |
| `MASTER_CTO_PIN` | 최초 시드시 | 마스터 `cto` 계정 최초 생성 비밀번호 |
| `MASTER_IRIUM_PIN` | 최초 시드시 | 마스터 `irium` 계정 최초 생성 비밀번호 |
| `CRON_SECRET` | 크론 사용시 | 무단결석 크론 인증 |

마스터 계정 시드 비밀번호는 **계정이 없을 때 최초 1회 생성**에만 쓰인다. 이미 있는 계정의 비밀번호는 절대 덮어쓰지 않는다.
배포 환경에서 값이 비어 있으면 고정값으로 폴백하지 않고 해당 계정 시드를 건너뛴다. 로컬 개발에서만 개발 전용 기본값을 쓴다.

## 문자 발송기 (scripts/sms-worker.mjs)

알리고 API 키가 IP 화이트리스트에 묶여 있어 Vercel(서버리스, 고정 IP 아님)에서는 알리고를 직접
부를 수 없다. 그래서 웹앱(`/m/sms`, `src/lib/sms.ts`)은 `sms_message` 큐에 넣기만 하고, **고정
공인 IP를 가진 VPS**(오라클 클라우드 무료 등급 등)에서 이 스크립트를 계속 띄워둬야 실제 발송이
된다.

**동작 방식** — 예전에는 이 스크립트를 짧은 간격(20초~1분)으로 반복 실행하며 "지금 보낼 게
있냐"고 계속 물어봤다. 지금은 VPS가 고정 공인 IP를 가지므로 웹앱이 발송기를 직접 부를 수 있어,
발송기는 **계속 떠 있는 작은 서버**가 되었다:

1. 웹앱이 큐에 새 문자를 넣을 때마다 발송기의 `/nudge`를 짧게 찔러 즉시 큐를 처리시킨다(전화번호·
   본문은 싣지 않는다 — 신호뿐이고, 발송기는 `/api/sms-worker`의 claim으로 큐에서 직접 읽어간다).
2. 찌르기가 실패해도(VPS 재부팅, 순간 네트워크 단절 등) 놓치지 않도록 **5분 간격의 느린 안전망**이
   같이 돈다. 시작 시 한 번도 즉시 처리해, 꺼져 있던 동안 쌓인 큐도 바로 집어간다.
3. 큐 자체(원자적 선점 `for update skip locked`, 최대 3회 재시도, 5분 백오프, 10분 중복 방지,
   하루 상한, 테스트 모드 기본값)는 그대로다 — 바뀐 건 "언제 집어가는지 아는 방법"뿐이다.

**VPS에서 띄우기**

```bash
node scripts/sms-worker.mjs
```

포그라운드에서 바로 종료되지 않고 계속 떠 있는다(내부 HTTP 서버 + 5분 타이머). 재부팅 후에도
자동으로 다시 뜨게 하려면 `pm2`나 `systemd` 같은 프로세스 매니저에 등록한다(둘 중 무엇을 쓰든
동일 — 이 스크립트는 특별한 종료 신호 처리를 요구하지 않는다).

**방화벽** — 발송기의 수신 포트(`SMS_WORKER_PORT`, 기본 `8787`) **하나만** 인바운드로 연다. 그
외 포트는 열 필요 없다(발송기가 웹앱·알리고를 부르는 건 전부 아웃바운드).

**필요한 환경변수** (`.env.example` 참고):

*발송기(VPS) 쪽에 설정 — 웹앱을 배포한 Vercel에는 이 표의 값들을 넣지 않는다:*

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `SMS_WORKER_SECRET` | 웹앱과 동일 값 필수 | `/api/sms-worker` claim/report 인증 및 `/nudge` 수신 인증(둘 다 타이밍 안전 비교, 같은 비밀 재사용). 미설정 시 로컬 개발용 고정값으로 폴백 |
| `SMS_WORKER_PORT` | 선택 | 발송기가 `/nudge`를 수신할 포트. 비우면 `8787`(22/80/443/3000과 겹치지 않는 임의의 높은 포트) |
| `ALIGO_API_KEY` | 필수 | 알리고 API 키 |
| `ALIGO_USER_ID` | 필수 | 알리고 계정 아이디 |
| `ALIGO_SENDER` | 필수 | 알리고에 사전 등록된 발신번호 |
| `STUDYCUBE_API_BASE` | 권장 | 웹앱 주소(기본 `http://localhost:3000`) |
| `ALIGO_SEND_LIVE` | 기본 미설정(테스트 모드) | `"true"`일 때만 실제 발송(과금 발생). 그 외에는 항상 `testmode_yn=Y` |

*웹앱(Vercel) 쪽에 설정:*

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `SMS_WORKER_SECRET` | 필수 | 위와 동일 값 — 발송기 인증에 쓴다 |
| `SMS_WORKER_URL` | 선택 | 발송기 주소(예: `http://<VPS 고정 IP>:8787`). 비우면 큐잉만 하고 찌르지 않는다 — VPS가 아직 없어도 큐잉은 항상 정상 동작한다 |

재시도는 최대 3회, 실패 후 5분 뒤에 다시 큐에 올라간다(`src/lib/sms.ts` SMS_MAX_ATTEMPTS·
RETRY_BACKOFF_MINUTES). 3회를 넘기면 `failed`로 확정되고, `/m/sms` 발송함에서 사람이 "다시
보내기"를 눌러야 다시 시도한다. 콘솔 로그에는 전화번호를 마스킹해서만 남기고(`010-****-5678`),
API 키는 절대 출력하지 않는다.
