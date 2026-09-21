// "Düzenleyen Birim" alanının İl Protokolü kipi -- eski admin-src/src/v4/roster.js'ten birebir.
// Kaynak: Samsun Valiliği "Tebrikata Giriş Sırası" protokol listesi -- gruplar VE grup içi sıra o
// listedeki protokol sırasını izler, alfabetik DEĞİL (dizi sırası korunur, sıralanmaz).
import { FACULTY_GROUPS } from '../protocol/protocolRules'

export const IL_PROTOCOL_UNIT_GROUPS: ReadonlyArray<{ title: string; items: readonly string[] }> = [
  { title: 'Mülki İdare ve Yerel Yönetim', items: ['Samsun Valiliği', 'Samsun Büyükşehir Belediyesi'] },
  {
    title: 'Garnizon ve Güvenlik',
    items: ['Samsun Garnizon Komutanlığı', 'Samsun İl Emniyet Müdürlüğü', 'Samsun İl Jandarma Komutanlığı', 'Sahil Güvenlik Karadeniz Bölge Komutanlığı'],
  },
  {
    title: 'Adliye',
    items: ['Samsun Cumhuriyet Başsavcılığı', 'Samsun Adli Yargı Adalet Komisyonu Başkanlığı', 'Samsun Bölge Adliye Mahkemesi', 'Samsun Bölge İdare Mahkemesi', 'Samsun Barosu'],
  },
  { title: 'Üniversiteler', items: ['Ondokuz Mayıs Üniversitesi', 'Samsun Üniversitesi'] },
  {
    title: 'Kaymakamlıklar',
    items: [
      'Alaçam Kaymakamlığı', 'Asarcık Kaymakamlığı', 'Atakum Kaymakamlığı', 'Ayvacık Kaymakamlığı', 'Bafra Kaymakamlığı',
      'Canik Kaymakamlığı', 'Çarşamba Kaymakamlığı', 'Havza Kaymakamlığı', 'İlkadım Kaymakamlığı', 'Kavak Kaymakamlığı',
      'Ladik Kaymakamlığı', '19 Mayıs Kaymakamlığı', 'Salıpazarı Kaymakamlığı', 'Tekkeköy Kaymakamlığı', 'Terme Kaymakamlığı',
      'Vezirköprü Kaymakamlığı', 'Yakakent Kaymakamlığı',
    ],
  },
  {
    title: 'İlçe Belediyeleri',
    items: [
      'Alaçam Belediyesi', 'Asarcık Belediyesi', 'Atakum Belediyesi', 'Ayvacık Belediyesi', 'Bafra Belediyesi',
      'Canik Belediyesi', 'Çarşamba Belediyesi', 'Havza Belediyesi', 'İlkadım Belediyesi', 'Kavak Belediyesi',
      'Ladik Belediyesi', '19 Mayıs Belediyesi', 'Salıpazarı Belediyesi', 'Tekkeköy Belediyesi', 'Terme Belediyesi',
      'Vezirköprü Belediyesi', 'Yakakent Belediyesi',
    ],
  },
  {
    title: 'İl Müdürlükleri ve Bölge Teşkilatı',
    items: [
      'Samsun İl Milli Eğitim Müdürlüğü', 'Samsun İl Sağlık Müdürlüğü', 'Samsun İl Kültür ve Turizm Müdürlüğü',
      'Samsun İl Tarım ve Orman Müdürlüğü', 'Samsun İl Afet ve Acil Durum Müdürlüğü (AFAD)',
      'Samsun Çevre, Şehircilik ve İklim Değişikliği İl Müdürlüğü', 'Samsun Gençlik ve Spor İl Müdürlüğü',
      'Samsun Aile ve Sosyal Hizmetler İl Müdürlüğü', 'Samsun Ticaret İl Müdürlüğü', 'Samsun Sanayi ve Teknoloji İl Müdürlüğü',
      'Samsun Çalışma ve İş Kurumu İl Müdürlüğü (İŞKUR)', 'Samsun SGK İl Müdürlüğü', 'Samsun Defterdarlığı',
      'Samsun İl Göç İdaresi Müdürlüğü', 'Samsun İl Nüfus ve Vatandaşlık Müdürlüğü',
      'Cumhurbaşkanlığı İletişim Başkanlığı Samsun Bölge Müdürlüğü', 'Orta Karadeniz Kalkınma Ajansı (OKA)',
    ],
  },
  {
    title: 'Meslek Kuruluşları',
    items: [
      'Samsun Ticaret ve Sanayi Odası', 'Samsun Ticaret Borsası', 'Samsun Esnaf ve Sanatkârları Odaları Birliği',
      'Samsun Ziraat Odası', 'Samsun Tabip Odası', '19 Mayıs Gazeteciler Cemiyeti',
    ],
  },
]

const IL_PROTOCOL_UNIT_SET = new Set(IL_PROTOCOL_UNIT_GROUPS.flatMap((g) => g.items))
const FACULTY_UNIT_SET = new Set(FACULTY_GROUPS.flatMap((g) => g.items))

export const isIlProtocolUnit = (name: string) => IL_PROTOCOL_UNIT_SET.has(name)
export const isFacultyUnit = (name: string) => FACULTY_UNIT_SET.has(name)
