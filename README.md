Roomly の `hotel_front` 向け監視コンソールです。共有 Firestore スキーマ v1.1 を前提に、着信監視、human チャット監視、返信、状態更新を行います。

`/admin` では `hotel_admin` による `hotel_front` スタッフ管理も扱います。

## Getting Started

```bash
npm run dev
```

## Environment Variables

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_DEFAULT_HOTEL_ID` 任意
- `NEXT_PUBLIC_DEFAULT_FRONT_EMAIL` 任意
- `FIREBASE_ADMIN_PROJECT_ID`
- `FIREBASE_ADMIN_CLIENT_EMAIL`
- `FIREBASE_ADMIN_PRIVATE_KEY`

## Authentication Assumption

Firebase Auth の email/password ログインを前提にしています。ログイン後、ID token の custom claims から以下を読みます。

- `role`: `hotel_front` または `hotel_admin`
- `hotel_id`: スタッフ所属ホテル
- `staff_user_id`: `uid` をそのまま利用

## Firestore

- `firestore.rules`: front プロジェクトが前提とするアクセス制御候補
- `firestore.indexes.json`: 監視クエリに必要な複合 index 定義
- `firebase.json`: rules / indexes の参照設定
- `users/{uid}`: ホテルスタッフのプロフィールと運用状態

## Verification

```bash
npm run lint
npm run build
```

## Open Questions

- guest 側と admin 側も Firebase Auth custom claims を使うか
- `messages` をトップレベル collection のまま運用するか、`chat_threads/{id}/messages` に寄せるか
- guest 側が `calls` と `chat_threads` を作成する時の Firestore Rules をどう表現するか
- `hotel_front` アカウント作成時に custom claims を誰が付与するか
