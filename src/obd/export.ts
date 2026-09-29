/**
 * Salida del informe.
 *
 * Compartir como texto falla con informes largos: la app de destino
 * (WhatsApp y otras) trunca el mensaje sin avisar. Por eso el camino
 * principal es un ARCHIVO .txt, que no tiene ese límite. El portapapeles
 * queda como alternativa y el texto también se puede leer en pantalla.
 */

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export interface ExportOutcome {
  ok: boolean;
  message: string;
}

/** Escribe el informe en un .txt y abre el menú de compartir con el archivo. */
export async function shareReportFile(text: string, prefix = 'informe-pids'): Promise<ExportOutcome> {
  try {
    const file = new File(Paths.cache, `${prefix}-${stamp()}.txt`);
    if (file.exists) file.delete();
    file.create({ overwrite: true });
    file.write(text);

    if (!(await Sharing.isAvailableAsync())) {
      return { ok: false, message: `Este teléfono no puede compartir archivos. El informe quedó guardado en ${file.uri}` };
    }
    await Sharing.shareAsync(file.uri, {
      mimeType: 'text/plain',
      dialogTitle: 'Enviar informe de PIDs',
      UTI: 'public.plain-text',
    });
    return { ok: true, message: 'Informe enviado como archivo .txt' };
  } catch (e: any) {
    return { ok: false, message: `No se pudo crear el archivo: ${e?.message ?? e}` };
  }
}

/** Copia el informe completo al portapapeles. */
export async function copyReport(text: string): Promise<ExportOutcome> {
  try {
    await Clipboard.setStringAsync(text);
    return { ok: true, message: `Informe copiado (${text.length} caracteres). Pégalo donde quieras.` };
  } catch (e: any) {
    return { ok: false, message: `No se pudo copiar: ${e?.message ?? e}` };
  }
}
