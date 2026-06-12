export interface BalanceData {
  accountNo: string;
  meterNo: string;
  balance: number;
  currentMonthConsumption: number;
  readingTime: string;
}

export interface ApiResponse {
  code: number;
  desc: string;
  data: BalanceData;
}

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}
