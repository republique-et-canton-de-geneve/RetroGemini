import React, { useState } from 'react';
import ModalDialog from './ModalDialog';
import { useTranslation } from '../../i18n/I18nContext';

/**
 * Thumbnails that open full size inside the app.
 *
 * Feedback images are stored as `data:` URIs (the upload reads them with
 * `FileReader.readAsDataURL`), and the thumbnails used to call
 * `window.open(img, '_blank')`. Browsers refuse a script-opened top-level
 * navigation to a `data:` URL — Chromium opens nothing at all — so clicking an
 * image did nothing, and only the context menu's "Open image in new tab" (a
 * navigation the browser itself starts) worked. A dialog needs no navigation,
 * works offline, stays inside the CSP (`img-src 'self' data:`), and goes
 * through ModalDialog like every other overlay.
 */

interface Props {
  images: string[];
  /** Accessible text for image `number` (1-based), from the caller's namespace. */
  altFor: (number: number) => string;
  className?: string;
}

const ImageGallery: React.FC<Props> = ({ images, altFor, className = 'flex flex-wrap gap-2 mb-3' }) => {
  const { t } = useTranslation();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (images.length === 0) return null;

  const openImage = openIndex !== null ? images[openIndex] : undefined;
  const openAlt = openIndex !== null ? altFor(openIndex + 1) : '';

  return (
    <>
      <div className={className}>
        {images.map((img, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => setOpenIndex(idx)}
            aria-haspopup="dialog"
            className="rounded-sm hover:opacity-80 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <img src={img} alt={altFor(idx + 1)} className="w-32 h-32 object-cover rounded-sm" />
          </button>
        ))}
      </div>

      {openImage !== undefined && (
        <ModalDialog
          label={openAlt}
          onClose={() => setOpenIndex(null)}
          overlayClassName="fixed inset-0 bg-black/80 flex items-center justify-center z-100 p-4"
          panelClassName="relative max-w-[95vw] max-h-[95vh] flex items-center justify-center"
        >
          <img
            src={openImage}
            alt={openAlt}
            className="max-w-[95vw] max-h-[90vh] object-contain rounded-sm bg-white shadow-2xl"
          />
          <button
            type="button"
            onClick={() => setOpenIndex(null)}
            aria-label={t('common.close')}
            className="absolute top-2 right-2 bg-slate-900/70 text-white rounded-full w-9 h-9 flex items-center justify-center hover:bg-slate-900"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </ModalDialog>
      )}
    </>
  );
};

export default ImageGallery;
