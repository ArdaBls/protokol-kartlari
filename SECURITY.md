# Güvenlik Politikası

Bu proje, Basın ve Halkla İlişkiler için Firebase Realtime Database ve Firebase Auth kullanan bir web uygulamasıdır. Repo herkese açık olduğu için kaynak kod (ve Firebase istemci yapılandırması) herkes tarafından görülebilir — bu Firebase uygulamaları için normaldir, gerçek güvenlik sınırı veritabanı kurallarıdır (bkz. `docs/firebase-database-rules.json`).

## Bir güvenlik açığı bulursanız

Lütfen **herkese açık bir GitHub Issue açmayın** — bu, sorunu kötü niyetli kişilere de duyurmuş olur.

Bunun yerine bu reponun **Security** sekmesinden **"Report a vulnerability"** (özel/gizli bildirim) seçeneğini kullanın. Bu, bildirimi yalnızca repo sahibinin görebileceği şekilde gönderir.

Bildiriminizde mümkünse şunları ekleyin:

- Sorunun kısa açıklaması ve etkisi (örn. yetkisiz veri okuma/yazma, kimlik doğrulama atlatma).
- Sorunu yeniden oluşturma adımları.
- Etkilenen dosya/yol (örn. hangi Firebase veritabanı yolu, hangi fonksiyon).

## Kapsam

Bu, küçük ölçekli, kapalı bir ekip tarafından kullanılan bir kurum içi araçtır — geniş çaplı bir bug bounty programı yoktur, ancak gerçek güvenlik açıklarını bildiren herkese teşekkür ederiz.
