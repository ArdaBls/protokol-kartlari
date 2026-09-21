import type { ReactNode } from 'react'

export type FaqCategory = 'getting-started' | 'kartlar' | 'takvim' | 'haber' | 'hesap' | 'uygulama'

export interface FaqItem {
  id: string
  category: FaqCategory
  question: string
  answer: ReactNode
  /** Aramada kullanılan düz metin karşılığı. */
  searchText: string
}

export const FAQ_CATEGORIES: ReadonlyArray<{ id: FaqCategory | 'all'; label: string }> = [
  { id: 'all', label: 'Tümü' },
  { id: 'getting-started', label: 'Başlarken' },
  { id: 'kartlar', label: 'Protokol kartları' },
  { id: 'takvim', label: 'Takvim' },
  { id: 'haber', label: 'Haber metni' },
  { id: 'hesap', label: 'Hesap' },
  { id: 'uygulama', label: 'Uygulama' },
]

const item = (id: string, category: FaqCategory, question: string, searchText: string, answer: ReactNode): FaqItem => ({
  id, category, question, answer, searchText,
})

export const FAQ_ITEMS: FaqItem[] = [
  item('giris', 'getting-started', 'Panele nasıl giriş yaparım?',
    'Giriş ekranında e-posta ve şifrenizle giriş yapabilirsiniz. Hesabınız yoksa kayıt olduktan sonra bir yöneticinin sizi onaylaması gerekir.',
    <>Giriş ekranında e-posta ve şifrenizle giriş yapabilirsiniz. Hesabınız yoksa kayıt olduktan sonra bir yöneticinin sizi onaylaması gerekir.</>),
  item('duzenleyemiyorum', 'getting-started', 'Hesabım oluşturuldu ama hiçbir şeyi düzenleyemiyorum, neden?',
    'Yeni hesaplar Beklemede rolüyle başlar. Bir yönetici sizi Editör veya Yönetici rolüne yükseltene kadar veri düzenleyemezsiniz.',
    <>Yeni hesaplar <strong>Beklemede</strong> rolüyle başlar. Bir yönetici sizi <strong>Editör</strong> veya <strong>Yönetici</strong> rolüne yükseltene kadar veri düzenleyemezsiniz.</>),
  item('telefon', 'getting-started', 'Site telefonda da düzgün çalışıyor mu?',
    'Evet, arayüz mobil kullanım için tasarlandı ve saha ekibi tarafından yoğunlukla telefondan kullanılıyor.',
    <>Evet — arayüz mobil kullanım için tasarlandı ve saha ekibi tarafından yoğunlukla telefondan kullanılıyor.</>),
  item('il-universite', 'kartlar', '"İl Protokol Sırası" ile "Üniversite Protokol Sırası" arasındaki fark nedir?',
    'İkisi ayrı listelerdir: biri il genelindeki protokol sırasını, diğeri üniversite içi protokol sırasını gösterir. Bir kişi her iki listede de görünebilir.',
    <>İkisi ayrı listelerdir: biri il genelindeki protokol sırasını, diğeri üniversite içi protokol sırasını gösterir. Bir kişi her iki listede de görünebilir. Protokol Kartları sayfasının sağ üstünden listeler arasında geçebilirsiniz.</>),
  item('sira-degistir', 'kartlar', 'Protokol sırasını nasıl değiştiririm?',
    'Düzenleme yetkiniz varsa Sıralamayı düzenle modunu açıp kişileri tutamaçtan sürükleyerek kendi sıraları içinde dizebilirsiniz. Değişiklik anında herkese yansır.',
    <>Düzenleme yetkiniz varsa <strong>Sıralamayı düzenle</strong> modunu açıp kişileri tutamaçtan sürükleyerek kendi protokol sıraları içinde dizebilirsiniz. Değişiklik anında herkese yansır.</>),
  item('kisi-ekle', 'kartlar', 'Yeni bir kişi/kart nasıl eklerim?',
    'Protokol Kartları sayfasının üstündeki Yeni kişi butonunu kullanın; ad, unvan ve fotoğraf bilgilerini girip kaydedin.',
    <>Protokol Kartları sayfasının üstündeki <strong>Yeni kişi</strong> butonunu kullanın; ad, unvan ve fotoğraf bilgilerini girip kaydedin.</>),
  item('etkinlik-ekle', 'takvim', 'Takvime nasıl etkinlik eklerim?',
    'Takvim sayfasında bir güne tıklayıp etkinlik başlığı, saat ve açıklama girerek kaydedebilirsiniz. Ekip için ortak paylaşılan bir takvimdir.',
    <>Takvim sayfasında bir güne tıklayıp etkinlik başlığı, saat ve açıklama girerek kaydedebilirsiniz. Ekip için ortak paylaşılan bir takvimdir.</>),
  item('takvim-gorunum', 'takvim', 'Takvimin gün/hafta/ay görünümünü nasıl değiştiririm?',
    'Takvim üstündeki görünüm sekmelerinden Gün, Hafta, Ay veya Liste görünümüne geçebilirsiniz.',
    <>Takvim üstündeki görünüm sekmelerinden <strong>Gün</strong>, <strong>Hafta</strong>, <strong>Ay</strong> veya <strong>Liste</strong> görünümüne geçebilirsiniz.</>),
  item('haber-uret', 'haber', 'Haber metni nasıl üretilir?',
    'Protokol Kartları sayfasında Haber çıktısı modunu açıp kişileri seçin; sistem Türkçe -in hâli kurallarına uygun otomatik haber cümlesi veya fotoğraf altyazısı üretir.',
    <>Protokol Kartları sayfasında <strong>Haber çıktısı</strong> modunu açıp kişileri seçin; sistem Türkçe -in hâli kurallarına uygun otomatik haber cümlesi veya fotoğraf altyazısı üretir.</>),
  item('haber-degistir', 'haber', 'Üretilen haber metnini değiştirebilir miyim?',
    'Evet, üretilen metin bir taslaktır. Kutunun içinde düzenleyip kopyalayabilirsiniz.',
    <>Evet, üretilen metin bir taslaktır — kutunun içinde düzenleyip kopyalayabilirsiniz.</>),
  item('sifre', 'hesap', 'Şifremi unuttum, ne yapmalıyım?',
    'Giriş ekranındaki Şifremi unuttum bağlantısını kullanarak e-postanıza sıfırlama bağlantısı alabilirsiniz.',
    <>Giriş ekranındaki <strong>Şifremi unuttum</strong> bağlantısını kullanarak e-postanıza sıfırlama bağlantısı alabilirsiniz.</>),
  item('roller', 'hesap', '"Editör" ile "Yönetici" rolü arasındaki fark nedir?',
    'Editörler protokol kartı ve takvim verilerini düzenleyebilir. Yöneticiler ayrıca kullanıcı rollerini değiştirebilir ve işlem günlüklerini görebilir.',
    <>Editörler protokol kartı ve takvim verilerini düzenleyebilir. Yöneticiler ayrıca kullanıcı rollerini değiştirebilir ve işlem günlüklerini (logları) görebilir.</>),
  item('rol-degistir', 'hesap', 'Bir kullanıcının rolünü nasıl değiştiririm?',
    'Yönetici iseniz Kullanıcı yönetimi sayfasından ilgili kullanıcının rolünü değiştirebilirsiniz.',
    <>Yönetici iseniz <strong>Kullanıcı yönetimi</strong> sayfasından ilgili kullanıcının rolünü değiştirebilirsiniz.</>),
  item('yukle', 'uygulama', 'Uygulamayı telefonuma nasıl yüklerim?',
    "Android ve bilgisayarda üst çubuktaki Uygulamayı yükle butonunu kullanın. iPhone ve iPad'de Safari paylaş menüsünden Ana Ekrana Ekle seçeneğini seçin.",
    <>Android ve bilgisayarda üst çubuktaki <strong>Uygulamayı yükle</strong> butonunu kullanın. iPhone ve iPad'de Safari'nin paylaş menüsünden <strong>Ana Ekrana Ekle</strong> seçeneğini seçin.</>),
  item('guncelleme', 'uygulama', '"Yeni sürüm hazır" uyarısı ne demek?',
    'Uygulamanın yeni bir sürümü yayınlandı. Açık formunuzu kaydettikten sonra Yenile butonuna basarak yeni sürüme geçebilirsiniz.',
    <>Uygulamanın yeni bir sürümü yayınlandı. Açık bir formunuz varsa önce kaydedin, sonra <strong>Yenile</strong> butonuna basarak yeni sürüme geçin.</>),
]
