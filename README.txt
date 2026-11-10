mía — кликабельный макет для портфолио

Открывать через локальный сервер (по двойному щелчку iframe с приложением не заработает):
  cd ~/mia-portfolio && python3 -m http.server 4670
  затем http://localhost:4670/

index.html  — страница-портфолио: телефон с живым приложением и список экранов
app/        — русская демоверсия приложения (сборка scripts/ru-site.cjs из mia-app, ветка feat/segment1-lesson-chat-retention)
paywall/    — экран оплаты (копия app/q/ru/ из ветки feat/ru-paywall)

Можно выложить на любой статический хостинг (GitHub Pages и т. п.) — всё работает без сервера.
