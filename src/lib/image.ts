const JPEG_QUALITY = 0.82

/** Görseli ortadan kare kırpar, verilen boyuta küçültür ve JPEG data URL'e çevirir (profil fotoğrafları için). */
export function resizeImageToSquare(file: File, size: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Dosya okunamadı.'))
    reader.onload = () => {
      const image = new Image()
      image.onerror = () => reject(new Error('Görsel okunamadı.'))
      image.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const context = canvas.getContext('2d')
        if (!context) {
          reject(new Error('Tarayıcı görsel işlemeyi desteklemiyor.'))
          return
        }
        const side = Math.min(image.width, image.height)
        context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, size, size)
        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY))
      }
      image.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}
