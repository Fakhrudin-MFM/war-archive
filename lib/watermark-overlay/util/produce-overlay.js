const sharp = require('sharp');
const canvas = require('canvas-prebuilt');
const {registerFont, createCanvas, Image} = canvas;
const {toAbsolute} = require('core/system');

/**
 * @param {{}} ctx
 * @param {String} text
 * @param {String} font
 * @param {Number} fontSize
 * @param {Number} imgWidth
 * @returns {String}
 */
function adjustFontSize(ctx, text, font, fontSize, imgWidth) {
  const fontParams = `${fontSize}px ${font}`;
  if (font && fontSize > 0) {
    ctx.font = fontParams;
    const textWidth = ctx.measureText(text).width;
    if (textWidth > imgWidth) {
      return adjustFontSize(ctx, text, font, fontSize - 1, imgWidth);
    }
  }
  return fontParams;
}

/**
 * @param {{}} options
 * @param {String} options.overlayPath
 * @param {String} options.width
 * @param {Number} options.height
 * @returns {Promise}
 */
function imgOverlay({overlayPath, width, height}) {
  if (!overlayPath || !width || !height) {
    return Promise.reject(new Error('не переданы необходимые параметры для watermark'));
  }
  let overlay = sharp(toAbsolute(overlayPath));
  return overlay
    .metadata()
    .then((meta) => {
      let ovWidth = meta.width > width / 2 ? parseInt(width / 2, 10) : meta.width;
      let ovHeight = meta.height > height / 2 ? parseInt(height / 2, 10) : meta.height;
      return overlay
        .resize(ovWidth, ovHeight)
        .background({r: 0, g: 0, b: 0, alpha: 0})
        .embed()
        .toBuffer();
    });
}

/**
 * @param {{}} options
 * @param {String} options.text
 * @param {String} options.width
 * @param {Number} options.height
 * @param {String} options.font
 * @param {String} options.fontSize
 * @param {Number} options.fontColor
 * @returns {Promise}
 */
function captionOverlay({text, width, height, font, fontSize, fontColor}) {
  text = text || '';
  width = width || 100;
  height = height || 100;
  fontSize = parseInt(fontSize) || 48;
  fontColor = fontColor || 'rgba(255, 255, 255, 0.7)';
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  let fontName = 'monospace';
  if (typeof font === 'string') {
    fontName = font;
  } else if (typeof font === 'object' && font && font.family) {
    fontName = font.name || font.family;
  }
  ctx.fillStyle = 'rgba(0, 0, 0, 0)';
  ctx.fillRect(0, 0, width, height);

  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'right';
  ctx.font = adjustFontSize(ctx, text, fontName, fontSize, width);
  ctx.fillStyle = fontColor;
  ctx.fillText(text, width, height);

  return canvas.toBuffer();
}

function patternImgOverlay({overlayPath, ratio, meta}) {
  if (!overlayPath) {
    return Promise.reject(new Error('не переданы необходимые параметры для watermark'));
  }
  ratio = ratio || 25;
  const diagonal = parseInt(Math.sqrt(meta.width * meta.height * ratio / 100));
  const side = Math.sqrt(Math.pow(diagonal, 2) / 2);
  const overlay = sharp(toAbsolute(overlayPath));
  return overlay
    .then(() => overlay
      .resize(parseInt(side))
      .background({r: 0, g: 0, b: 0, alpha: 0})
      .embed()
      .toBuffer()
    )
    .then((imgData) => {
      const img = new Image();
      img.src = imgData;
      const canvas = createCanvas(diagonal, diagonal);
      const ctx = canvas.getContext('2d');
      ctx.translate(0, diagonal / 2);
      ctx.rotate(-Math.PI / 4);
      ctx.drawImage(img, 0, 0);

      const pCanvas = createCanvas(meta.width, meta.height);
      const pCtx = pCanvas.getContext('2d');
      const ptrn = pCtx.createPattern(canvas, 'repeat');
      pCtx.fillStyle = ptrn;
      pCtx.fillRect(0, 0, pCanvas.width, pCanvas.height);

      return pCanvas.toBuffer();
    });
}

function patternCaptionOverlay({text, ratio, font, fontSize, fontColor, meta}) {
  text = text || '';
  ratio = ratio || 25;
  const diagonal = parseInt(Math.sqrt(meta.width * meta.height * ratio / 100));
  const side = Math.sqrt(Math.pow(diagonal, 2) / 2);
  fontSize = parseInt(fontSize) || 48;
  fontColor = fontColor || 'rgba(255, 255, 255, 0.7)';
  const canvas = createCanvas(diagonal, diagonal);
  const ctx = canvas.getContext('2d');
  let fontName = 'monospace';
  if (typeof font === 'string') {
    fontName = font;
  } else if (typeof font === 'object' && font && font.family) {
    fontName = font.name || font.family;
  }

  ctx.translate(0, diagonal / 2);
  ctx.rotate(-Math.PI / 4);
  ctx.fillStyle = 'rgba(0, 0, 0, 0)';
  ctx.fillRect(0, 0, side, side);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.font = adjustFontSize(ctx, text, fontName, fontSize, side);
  ctx.fillStyle = fontColor;
  ctx.fillText(text, side / 2, side / 2);

  const pCanvas = createCanvas(meta.width, meta.height);
  const pCtx = pCanvas.getContext('2d');
  const ptrn = pCtx.createPattern(canvas, 'repeat');
  pCtx.fillStyle = ptrn;
  pCtx.fillRect(0, 0, pCanvas.width, pCanvas.height);

  return pCanvas.toBuffer();
}

/**
 * @param {{}} meta
 * @param {{}} options
 * @returns {Promise|Buffer}
 */
function produceOverlay(meta, options) {
  options.width = parseInt(options.width) || meta.width;
  options.height = parseInt(options.height) || meta.height;
  options.width = meta.width < options.width ? meta.width : options.width;
  options.height = meta.height < options.height ? meta.height : options.height;
  options.text = options.text || '';
  options.meta = meta;
  if (options.overlayPath) {
    return options.pattern ? patternImgOverlay(options) : imgOverlay(options);
  } else if (options.pattern) {
    return patternCaptionOverlay(options);
  }
  return captionOverlay(options);
}

/**
 * @param {String|Buffer} imgSource
 * @param {{}} options
 * @returns {Promise}
 */
function watermarkApplier(imgSource, options) {
  options = options || {};
  if (!process.env.FONTCONFIG_PATH && options.configPath) {
    process.env.FONTCONFIG_PATH = toAbsolute(options.configPath);
  }
  let format = options.format || 'png';
  let image = sharp(imgSource);
  return image
    .metadata()
    .then(meta => produceOverlay(meta, options))
    .then(overlay => image.png()
      .overlayWith(overlay, {gravity: sharp.gravity.southeast})
      .toFormat(format.toLowerCase())
      .toBuffer());
}

/**
 * @param {Stream} imgStream
 * @param {{}} options
 * @returns {Promise}
 */
function watermarkStream(imgStream, options) {
  options = options || {};
  if (!process.env.FONTCONFIG_PATH && options.configPath) {
    process.env.FONTCONFIG_PATH = toAbsolute(options.configPath);
  }
  return new Promise((resolve, reject) => {
    try {
      let image = sharp();

      image
        .metadata()
        .then(meta => produceOverlay(meta, options))
        .then((overlay) => {
          const overlayStream = image
            .png()
            .overlayWith(overlay, {gravity: sharp.gravity.southeast});
          return resolve(overlayStream);
        })
        .catch(err => reject(err));

      imgStream.on('error', err => reject(err));
      imgStream.pipe(image);
    } catch (err) {
      reject(err);
    }
  });
}

exports.produceOverlay = produceOverlay;
exports.registerFont = registerFont;
