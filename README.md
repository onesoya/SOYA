# SOYA

SOYA는 체성분, 식사, 운동, 월경과 주간 상담을 한 흐름으로 기록하는 개인 건강 앱입니다.

## 기술 구성

- Next.js 16 / React 19
- Firebase Authentication (Google 로그인)
- Cloud Firestore (사용자별 기록)
- Firebase Cloud Messaging + Cloud Functions (알림)
- Firebase App Hosting (GitHub `main` 자동 배포)

## 로컬 실행

Node.js 22 이상이 필요합니다.

```bash
npm install
npm run dev
```

검증 명령:

```bash
npm run typecheck
npm run build
```

## 데이터 원칙

- 모든 건강 기록은 로그인한 Firebase 사용자 UID 아래에 저장됩니다.
- 새로운 계정은 프로토타입의 샘플 기록을 가져오지 않고 빈 기록으로 시작합니다.
- Firebase 보안 규칙은 본인 UID의 기록만 읽고 수정할 수 있도록 제한합니다.
- API 키와 외부 서비스 비밀값은 Git에 저장하지 않고 Firebase Secret Manager에서 관리합니다.

## 배포

Firebase App Hosting에서 `onesoya/SOYA` 저장소의 `main` 브랜치를 연결합니다. 이후 `main`에 새 커밋이 올라가면 자동으로 빌드하고 배포합니다.
