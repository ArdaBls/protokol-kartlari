const MAX_PHOTO_SIDE = 480
const JPEG_QUALITY = 0.75

/** Cihazdan seçilen fotoğrafı en uzun kenarı 480px olacak şekilde küçültüp JPEG data URL'e çevirir. */
export function compressImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Dosya okunamadı'))
    reader.onload = () => {
      const image = new Image()
      image.onerror = () => reject(new Error('Görsel çözümlenemedi'))
      image.onload = () => {
        const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(image.width, image.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(image.width * scale)
        canvas.height = Math.round(image.height * scale)
        const context = canvas.getContext('2d')
        if (!context) {
          reject(new Error('Tarayıcı görsel sıkıştırmayı desteklemiyor'))
          return
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY))
      }
      image.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}
