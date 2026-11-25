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
            // Hover deepens the shadow only: no fade (it hid what the
            // thumbnail shows) and no lift (boxes do not move under a pointer).
            className="rounded-lg shadow-xs hover:shadow-md transition-shadow focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2"
          >
            <img src={img} alt={altFor(idx + 1)} className="block w-32 h-32 object-cover rounded-lg border border-slate-200" />
          </button>
        ))}
      </div>

      {openImage !== undefined && (
        <ModalDialog
          label={openAlt}
          onClose={() => setOpenIndex(null)}
          // The close button below is `fixed`: a transformed panel would carry
          // it along while the dialog rises, so this one only fades in.
          entrance="fade"
          overlayClassName="fixed inset-0 bg-slate-900/85 flex items-center justify-center z-100 p-4"
          panelClassName="relative max-w-[95vw] max-h-[95vh] flex items-center justify-center"
        >
          <img
            src={openImage}
            alt={openAlt}
            className="max-w-[95vw] max-h-[90vh] object-contain rounded-xl bg-white shadow-2xl"
          />
          {/* Anchored to the screen corner, not the image: on a screenshot the
              top-right corner is often the detail the report is about. */}
          <button
            type="button"
            onClick={() => setOpenIndex(null)}
            aria-label={t('common.close')}
            className="fixed top-4 right-4 bg-slate-900/80 text-white rounded-full w-11 h-11 flex items-center justify-center hover:bg-slate-900 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
          >
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </ModalDialog>
      )}
    </>
  );
};

export default ImageGallery;
