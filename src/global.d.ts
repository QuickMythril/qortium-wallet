// src/global.d.ts

interface QdnRequestOptions {
  action: string;
  address?: string;
  amount?: number | string;
  assetId?: number;
  assetName?: string;
  base64?: string;
  blockchain?: string;
  blob?: Blob;
  blockLimit?: number;
  coins?: string[];
  currencies?: string[];
  include24hChange?: boolean;
  category?: string;
  coin?: string;
  confirmationStatus?: string;
  creationBytes?: string;
  data64?: string;
  description?: string;
  destinationAddress?: string;
  encoding?: string;
  encryptedData?: string;
  exactMatchNames?: boolean;
  excludeBlocked?: boolean;
  excludeZero?: boolean;
  fee?: number | string;
  feePerByte?: string;
  file?: File;
  filename?: string;
  host?: string;
  identifier?: string;
  includeMetadata?: boolean;
  item?: string;
  items?: string[];
  limit?: number;
  listName?: string;
  maxBytes?: number;
  memo?: string;
  metaData?: string;
  method?: string;
  mimeType?: string;
  mode?: string;
  name?: string;
  notificationIds?: string[];
  offset?: number;
  path?: string;
  port?: number;
  query?: string;
  rating?: number;
  recipient?: string;
  resources?: any[];
  reverse?: boolean;
  service?: string;
  sendMax?: boolean;
  startBlock?: number;
  subscriptions?: unknown[];
  tag1?: string;
  tag2?: string;
  tag3?: string;
  tag4?: string;
  tag5?: string;
  tags?: string[] | string;
  title?: string;
  txGroupId?: number;
  txType?: TransactionType | TransactionType[];
  type?: string;
  verified?: boolean;
}

declare function qdnRequest(options: QdnRequestOptions): Promise<any>;
declare function qortalRequest(options: QdnRequestOptions): Promise<any>;

declare global {
  interface Window {
    _qdnBase: any;
    _qdnTheme?: string;
    _qdnLang?: string;
    _qdnTextSize?: string;
  }
}

declare global {
  interface Window {
    showSaveFilePicker: (
      options?: SaveFilePickerOptions
    ) => Promise<FileSystemFileHandle>;
  }
}
