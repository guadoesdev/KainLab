# Security Specification — AI Nutrition Tracker

## 1. Data Invariants
1. Every `/users/{userId}` document belongs strictly to `request.auth.uid == userId`, requires `email_verified == true` for writes, excludes PII (`email`), and enforces `dailyCalorieGoal` in `[800, 10000]`.
2. PII (`email`) is isolated in `/users/{userId}/private/contact`, readable/writable strictly by `isOwner(userId)`.
3. Every `/users/{userId}/meals/{mealId}` document is owner-scoped (`userId == request.auth.uid`), requires `foods` to be a bounded array (`1..20` strings), enforces finite nutrition bounds (`calories: 0..10000`, `protein/carbs/fat: 0..1000`), and locks `userId`, `id`, `dateKey`, `source`, `confidence`, and `createdAt` against mutation.
4. Every `/users/{userId}/chatMessages/{messageId}` document is owner-scoped, immutable (`allow update: if false`), and enforces strict key/size/array bounds.
5. `allow list` on subcollections (`/users/{userId}/meals`, `/users/{userId}/chatMessages`) strictly evaluates `isOwner(userId)` without `get()` or `exists()`.

## 2. Adversarial "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. Unauthenticated read or list of `/users/user_1/meals`.
2. Authenticated non-owner (`user_2`) reading `/users/user_1/meals/meal_1` or `/users/user_1/chatMessages/msg_1`.
3. Non-owner reading `/users/user_1/private/contact` (PII leak test).
4. Unverified email user writing `/users/user_1/meals/meal_1`.
5. Shadow field injection (`isAdmin: true`, `bonus: 500`) on `MealEntry` or `ChatMessage`.
6. Unbounded `foods` array (`25` items) or invalid element type (`foods: [123]`) on `MealEntry`.
7. Negative or excessive calories (`calories: -50` or `calories: 999999`).
8. Mutating immutable `source`, `confidence`, `dateKey`, or `createdAt` when editing a meal.
9. Timestamp forgery (`createdAt != request.time` on create or `updatedAt != request.time` on update).
10. ID poisoning (`mealId` > 128 chars or containing invalid symbols).
11. Mutating an existing `ChatMessage` (`update` attempt).
12. Setting `dailyCalorieGoal` below `800` or above `10000` on `/users/{userId}`.
