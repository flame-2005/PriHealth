import { NativeModules } from 'react-native';

const { ExportFileModule } = NativeModules;

/** Writes a text file into the user's Downloads folder via MediaStore. Returns the URI/path. */
export const ExportFile = {
  saveToDownloads(fileName: string, mimeType: string, content: string): Promise<string> {
    if (!ExportFileModule?.saveToDownloads) return Promise.reject(new Error('ExportFileModule unavailable'));
    return ExportFileModule.saveToDownloads(fileName, mimeType, content);
  },
};
