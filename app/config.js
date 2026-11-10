/* Русская версия /ru/ — показ продукта: оплата проходит сразу (paymentMode test + demo, без пометок «тест»),
   сервера, аккаунтов, напоминаний и записей лекций нет. Ключи хранилища — mia-ru-* (подставляет scripts/ru-site.cjs).
   calmAudioBase — папка русских записей 15 практик «Хочу ему написать» (app/audio/calm-ru/calm-NN.m4a).
   priceXFull — цена продления после цены входа (показ: зачёркнутая обычная цена). В испанской live-версии её нет, пока не настроены Stripe и App Store (docs/TZ-CENA-VHODA.md). */
window.MiaConfig={paymentMode:'test',demo:true,audio:false,calmAudioBase:'audio/calm-ru',priceWeek:9.99,priceMonth:29.99,priceMonths4:59.99,priceWeekFull:14.99,priceMonthFull:59.99,priceMonths4Full:119.99,priceReport:0.99,priceReportFull:6.99,currency:'EUR',testTools:false,apiBase:'',appStoreUrl:'',legalBase:'/landing/legal/ru/',bonusUrl:'/landing/bonus/kak-ty.html',appVersion:'0.1.0'};
