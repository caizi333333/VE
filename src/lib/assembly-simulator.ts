export interface SimulatorState {
  registers: {
    A: number;
    B: number;
    SP: number;
    DPL: number;
    DPH: number;
    [key: string]: number; // For R0-R7
  };
  ram: Uint8Array;
  pc: number; // Program Counter
  psw: {
    CY: boolean; // Carry
    AC: boolean; // Auxiliary Carry
    F0: boolean; // User Flag 0
    RS1: boolean;
    RS0: boolean;
    OV: boolean; // Overflow
    P: boolean;  // Parity
  };
  portValues: {
    P0: number;
    P1: number;
    P2: number;
    P3: number;
  };
  /** 当前指令在源代码中的行号(从0开始)。找不到则为 -1 */
  currentLine: number;
  /**
   * 汇编指令文本数组，用于 UI 显示和进度计算。
   * 长度与内部 instructions 数组保持一致。
   */
  memory: string[];
  // 串口通信状态
  uart: {
    SCON: number;    // 串口控制寄存器
    SBUF: number;    // 串口缓冲器
    TI: boolean;     // 发送中断标志
    RI: boolean;     // 接收中断标志
    transmitBuffer: string;  // 发送缓冲区
    receiveBuffer: string;   // 接收缓冲区
    baudRate: number;        // 波特率
    dataTransmitting: boolean; // 正在传输数据
  };
  // 定时器状态
  timers: {
    TCON: number;    // 定时器控制寄存器
    TMOD: number;    // 定时器模式寄存器
    TH0: number;     // 定时器0高8位
    TL0: number;     // 定时器0低8位
    TH1: number;     // 定时器1高8位
    TL1: number;     // 定时器1低8位
    TR0: boolean;    // 定时器0运行控制
    TR1: boolean;    // 定时器1运行控制
    TF0: boolean;    // 定时器0溢出标志
    TF1: boolean;    // 定时器1溢出标志
    overflowCount0: number;  // 定时器0溢出计数
    overflowCount1: number;  // 定时器1溢出计数
  };
  // 中断状态
  interrupts: {
    IE: number;      // 中断允许寄存器
    IP: number;      // 中断优先级寄存器
    EA: boolean;     // 总中断允许
    ET0: boolean;    // 定时器0中断允许
    ET1: boolean;    // 定时器1中断允许
    EX0: boolean;    // 外部中断0允许
    EX1: boolean;    // 外部中断1允许
    ES: boolean;     // 串口中断允许
    pendingInterrupts: string[]; // 待处理中断队列
  };
  // ADC状态 (ADC0809)
  adc: {
    channelSelect: number;   // 当前选择的通道(0-7)
    conversionActive: boolean; // 转换进行中
    conversionComplete: boolean; // 转换完成
    lastResult: number;      // 最后转换结果
    inputVoltages: number[]; // 8个通道的输入电压(0-5V)
    referenceVoltage: number; // 参考电压
    conversionTime: number;  // 转换时间(微秒)
  };
  // 蜂鸣器状态
  buzzer: {
    active: boolean;         // 蜂鸣器是否激活
    frequency: number;       // 频率(Hz)
    dutyCycle: number;      // 占空比(%)
    outputPin: string;      // 输出引脚(如P2.1)
    soundPattern: 'continuous' | 'beep' | 'alarm' | 'melody'; // 声音模式
  };
  // 矩阵键盘状态 (4x4)
  keypad: {
    matrix: boolean[][];     // 4x4按键状态矩阵
    rowPins: string[];      // 行扫描引脚
    colPins: string[];      // 列读取引脚
    lastKeyPressed: string; // 最后按下的键
    scanActive: boolean;    // 是否正在扫描
    debounceTime: number;   // 去抖延时
  };
  // LCD显示器状态 (1602/2004)
  lcd: {
    displayEnabled: boolean; // 显示使能
    cursorPosition: { row: number; col: number }; // 光标位置
    displayData: string[][]; // 显示内容(2行x16列 或 4行x20列)
    backlight: boolean;     // 背光状态
    controlPins: {
      RS: string;  // 寄存器选择引脚
      EN: string;  // 使能引脚
      RW: string;  // 读写选择引脚
    };
    dataPins: string[];     // 数据引脚(4位或8位模式)
    mode: '4bit' | '8bit';  // 数据位模式
    initialized: boolean;   // 是否已初始化
  };
  // 步进电机状态
  stepperMotor: {
    currentStep: number;    // 当前步序(0-7)
    direction: 'clockwise' | 'counterclockwise'; // 转动方向
    speed: number;          // 转速(步/秒)
    controlPins: string[];  // 控制引脚(A, B, C, D相)
    stepPattern: number[];  // 步序表
    totalSteps: number;     // 总步数计数
    isRunning: boolean;     // 是否正在运行
  };
  // PWM输出状态
  pwm: {
    channels: {
      pin: string;
      frequency: number;    // 频率(Hz)
      dutyCycle: number;   // 占空比(0-100%)
      enabled: boolean;    // 是否使能
      currentLevel: boolean; // 当前输出电平
    }[];
  };
  machineCycles: number; // Classic 12T 8051 machine-cycle model; not physical elapsed time
  terminated: boolean;
}

export interface Instruction {
  label?: string;
  mnemonic: string;
  operands: string[];
  line: number;
  address: number; // Add address property
}

export interface ExecutionTraceEntry {
  step: number;
  pc: number;
  instruction: string;
  line: number;
  regChanges: { name: string; from: number; to: number }[];
  memChanges: { addr: number; from: number; to: number }[];
  portChanges: { port: string; from: number; to: number }[];
  flagChanges: { flag: string; from: boolean; to: boolean }[];
}

export class Simulator {
  private code: string;
  private instructions: Instruction[] = [];
  private instructionMap: Map<number, Instruction> = new Map();
  private labels: Map<string, number> = new Map();
  private symbols: Map<string, string> = new Map(); // EQU/BIT/DATA symbol table
  private codeMemory: Uint8Array = new Uint8Array(65536); // Code memory for DB/DW/MOVC
  // 外部数据存储器（MOVX 访问，64KB）。未写过的单元读 0xFF（总线悬空的真实表现）；
  // 写入后可读回，使 MOVX @DPTR,A ↔ MOVX A,@DPTR 形成真实往返（此前写操作被丢弃）
  private xram: Uint8Array = new Uint8Array(65536).fill(0xFF);
  private pcHistory: number[] = []; // PC历史记录用于循环检测
  private stepCount: number = 0;
  private inInterrupt: boolean = false; // 是否正处于中断服务程序内（阻止重入，RETI 清除）
  private instrCount: number = 0; // 累计经典12T机器周期数
  private lastBuzzerToggleAt: number = -1; // 蜂鸣器引脚上一次电平翻转时的指令计数
  private buzzerPin: string | null = null; // 实验声明的蜂鸣器输出引脚（如 P2.0），跨 reset 保持
  // 瞬时按键的待恢复队列：拉低若干条指令（模型时间）后自动回高
  private pendingPulses: { port: 'P0' | 'P1' | 'P2' | 'P3'; bit: number; remaining: number }[] = [];
  // 8051 的同地址 SBUF 读写对应不同缓冲器，发送不能覆盖尚待程序读取的接收字节。
  private receivedSbuf: number | null = null;
  // Standard 8051 SFR address map (no duplicates, correct addresses per datasheet)
  private sfrMap: Map<number, string> = new Map([
    [0x80, 'P0'], [0x81, 'SP'], [0x82, 'DPL'], [0x83, 'DPH'],
    [0x87, 'PCON'],
    [0x88, 'TCON'], [0x89, 'TMOD'], [0x8A, 'TL0'], [0x8B, 'TL1'],
    [0x8C, 'TH0'], [0x8D, 'TH1'],
    [0x90, 'P1'],
    [0x98, 'SCON'], [0x99, 'SBUF'],
    [0xA0, 'P2'], [0xA8, 'IE'],
    [0xB0, 'P3'], [0xB8, 'IP'],
    [0xC8, 'T2CON'], [0xCA, 'RCAP2L'], [0xCB, 'RCAP2H'], [0xCC, 'TL2'], [0xCD, 'TH2'],
    [0xD0, 'PSW'],
    [0xE0, 'ACC'], [0xF0, 'B'],
  ]);

  private sfrNameToAddr: Map<string, number> = new Map(
    [...this.sfrMap.entries()].map(([addr, name]) => [name.toUpperCase(), addr])
  );

  public state: SimulatorState;

  constructor(code: string = '') {
    this.code = code || '';
    this.state = this.getInitialState();
    this.parseCode();
  }

  public reset(): void {
    this.state = this.getInitialState();
    this.pcHistory = [];
    this.stepCount = 0;
    this.inInterrupt = false;
    this.instrCount = 0;
    this.lastBuzzerToggleAt = -1;
    this.pendingPulses = [];
    this.receivedSbuf = null;
    this.xram.fill(0xFF);
    if (this.buzzerPin) this.state.buzzer.outputPin = this.buzzerPin;
  }

  public updateCode(code: string): void {
    this.code = code || '';
    this.instructions = [];
    this.instructionMap.clear();
    this.labels.clear();
    this.symbols.clear();
    this.codeMemory.fill(0);
    this.pcHistory = []; // 重置PC历史记录
    this.inInterrupt = false;
    this.instrCount = 0;
    this.lastBuzzerToggleAt = -1;
    this.pendingPulses = [];
    this.receivedSbuf = null;
    this.xram.fill(0xFF);
    this.state = this.getInitialState();
    if (this.buzzerPin) this.state.buzzer.outputPin = this.buzzerPin;
    this.parseCode();
  }

  private getInitialState(): SimulatorState {
    return {
      registers: {
        A: 0, B: 0, SP: 0x07, DPL: 0, DPH: 0,
        R0: 0, R1: 0, R2: 0, R3: 0, R4: 0, R5: 0, R6: 0, R7: 0,
      },
      ram: new Uint8Array(128),
      pc: 0,
      psw: { CY: false, AC: false, F0: false, RS1: false, RS0: false, OV: false, P: false },
      portValues: { P0: 0xFF, P1: 0xFF, P2: 0xFF, P3: 0xFF },
      currentLine: -1,
      memory: [],
      // 串口通信初始状态
      uart: {
        SCON: 0x00,
        SBUF: 0x00,
        TI: false,
        RI: false,
        transmitBuffer: '',
        receiveBuffer: '',
        baudRate: 9600,
        dataTransmitting: false,
      },
      // 定时器初始状态
      timers: {
        TCON: 0x00,
        TMOD: 0x00,
        TH0: 0x00,
        TL0: 0x00,
        TH1: 0x00,
        TL1: 0x00,
        TR0: false,
        TR1: false,
        TF0: false,
        TF1: false,
        overflowCount0: 0,
        overflowCount1: 0,
      },
      // 中断初始状态
      interrupts: {
        IE: 0x00,
        IP: 0x00,
        EA: false,
        ET0: false,
        ET1: false,
        EX0: false,
        EX1: false,
        ES: false,
        pendingInterrupts: [],
      },
      // ADC初始状态
      adc: {
        channelSelect: 0,
        conversionActive: false,
        conversionComplete: true,
        lastResult: 0,
        inputVoltages: [0, 0, 0, 0, 0, 0, 0, 0],
        referenceVoltage: 5,
        conversionTime: 0,
      },
      // 蜂鸣器初始状态
      buzzer: {
        active: false,
        frequency: 0,
        dutyCycle: 50,
        outputPin: 'P2.1',
        soundPattern: 'continuous',
      },
      // 矩阵键盘初始状态
      keypad: {
        matrix: Array.from({ length: 4 }, () => Array(4).fill(false)),
        rowPins: ['P3.0', 'P3.1', 'P3.2', 'P3.3'],
        colPins: ['P2.0', 'P2.1', 'P2.2', 'P2.3'],
        lastKeyPressed: '',
        scanActive: false,
        debounceTime: 0,
      },
      // LCD初始状态
      lcd: {
        displayEnabled: false,
        cursorPosition: { row: 0, col: 0 },
        displayData: Array.from({ length: 2 }, () => Array(16).fill('')),
        backlight: true,
        controlPins: {
          RS: 'P0.0',
          EN: 'P0.1',
          RW: 'P0.2',
        },
        dataPins: ['P1.0', 'P1.1', 'P1.2', 'P1.3'],
        mode: '4bit',
        initialized: false,
      },
      // 步进电机初始状态
      stepperMotor: {
        currentStep: 0,
        direction: 'clockwise',
        speed: 0,
        controlPins: ['P2.0', 'P2.1', 'P2.2', 'P2.3'],
        stepPattern: [0b1000, 0b1100, 0b0100, 0b0110, 0b0010, 0b0011, 0b0001, 0b1001],
        totalSteps: 0,
        isRunning: false,
      },
      // PWM初始状态
      pwm: {
        channels: [
          { pin: 'P1.4', frequency: 0, dutyCycle: 0, enabled: false, currentLevel: false },
          { pin: 'P1.5', frequency: 0, dutyCycle: 0, enabled: false, currentLevel: false },
          { pin: 'P1.6', frequency: 0, dutyCycle: 0, enabled: false, currentLevel: false },
          { pin: 'P1.7', frequency: 0, dutyCycle: 0, enabled: false, currentLevel: false },
        ],
      },
      machineCycles: 0,
      terminated: false,
    };
  }

  private isWorkingRegisterName(operand: string): boolean {
    return /^R[0-7]$/i.test(operand);
  }

  private getRegisterBankBase(): number {
    return ((this.state.psw.RS1 ? 2 : 0) | (this.state.psw.RS0 ? 1 : 0)) * 8;
  }

  private syncWorkingRegisterMirror(): void {
    const base = this.getRegisterBankBase();
    for (let i = 0; i < 8; i++) {
      this.state.registers[`R${i}`] = this.state.ram[base + i] || 0;
    }
  }

  private getWorkingRegisterValue(operand: string): number {
    const index = parseInt(operand.substring(1), 10);
    const value = this.state.ram[this.getRegisterBankBase() + index] || 0;
    this.state.registers[`R${index}`] = value;
    return value;
  }

  private setWorkingRegisterValue(operand: string, value: number): void {
    const index = parseInt(operand.substring(1), 10);
    const byteValue = value & 0xFF;
    this.state.ram[this.getRegisterBankBase() + index] = byteValue;
    this.state.registers[`R${index}`] = byteValue;
  }

  private getPSWValue(): number {
    let psw = 0;
    if (this.state.psw.CY) psw |= 0x80;
    if (this.state.psw.AC) psw |= 0x40;
    if (this.state.psw.F0) psw |= 0x20;
    if (this.state.psw.RS1) psw |= 0x10;
    if (this.state.psw.RS0) psw |= 0x08;
    if (this.state.psw.OV) psw |= 0x04;
    if (this.state.psw.P) psw |= 0x01;
    return psw;
  }

  private setPSWValue(value: number): void {
    this.state.psw.CY = (value & 0x80) !== 0;
    this.state.psw.AC = (value & 0x40) !== 0;
    this.state.psw.F0 = (value & 0x20) !== 0;
    this.state.psw.RS1 = (value & 0x10) !== 0;
    this.state.psw.RS0 = (value & 0x08) !== 0;
    this.state.psw.OV = (value & 0x04) !== 0;
    this.state.psw.P = (value & 0x01) !== 0;
    this.syncWorkingRegisterMirror();
  }

  private getSfrValueByName(name: string): number | undefined {
    switch (name.toUpperCase()) {
      case 'P0': return this.state.portValues.P0;
      case 'P1': return this.state.portValues.P1;
      case 'P2': return this.state.portValues.P2;
      case 'P3': return this.state.portValues.P3;
      case 'SP': return this.state.registers.SP;
      case 'DPL': return this.state.registers.DPL;
      case 'DPH': return this.state.registers.DPH;
      case 'PCON': return 0;
      case 'TCON': return this.state.timers.TCON;
      case 'TMOD': return this.state.timers.TMOD;
      case 'TL0': return this.state.timers.TL0;
      case 'TL1': return this.state.timers.TL1;
      case 'TH0': return this.state.timers.TH0;
      case 'TH1': return this.state.timers.TH1;
      case 'SCON': return this.state.uart.SCON;
      case 'SBUF': return this.receivedSbuf ?? this.state.uart.SBUF;
      case 'IE': return this.state.interrupts.IE;
      case 'IP': return this.state.interrupts.IP;
      case 'PSW': return this.getPSWValue();
      case 'ACC': return this.state.registers.A;
      case 'B': return this.state.registers.B;
      case 'T2CON':
      case 'RCAP2L':
      case 'RCAP2H':
      case 'TL2':
      case 'TH2':
        return 0;
      default:
        return undefined;
    }
  }

  private setSfrValueByName(name: string, value: number): boolean {
    const byteValue = value & 0xFF;
    switch (name.toUpperCase()) {
      case 'P0': this.state.portValues.P0 = byteValue; return true;
      case 'P1': this.state.portValues.P1 = byteValue; return true;
      case 'P2': this.state.portValues.P2 = byteValue; return true;
      case 'P3': this.state.portValues.P3 = byteValue; return true;
      case 'SP': this.state.registers.SP = byteValue; return true;
      case 'DPL': this.state.registers.DPL = byteValue; return true;
      case 'DPH': this.state.registers.DPH = byteValue; return true;
      case 'PCON': return true;
      case 'TMOD': this.state.timers.TMOD = byteValue; return true;
      case 'TCON':
        this.state.timers.TCON = byteValue;
        this.state.timers.TR0 = (byteValue & 0x10) !== 0;
        this.state.timers.TR1 = (byteValue & 0x40) !== 0;
        this.state.timers.TF0 = (byteValue & 0x20) !== 0;
        this.state.timers.TF1 = (byteValue & 0x80) !== 0;
        return true;
      case 'TL0': this.state.timers.TL0 = byteValue; return true;
      case 'TL1': this.state.timers.TL1 = byteValue; return true;
      case 'TH0': this.state.timers.TH0 = byteValue; return true;
      case 'TH1': this.state.timers.TH1 = byteValue; return true;
      case 'SCON':
        this.state.uart.SCON = byteValue;
        this.state.uart.TI = (byteValue & 0x02) !== 0;
        this.state.uart.RI = (byteValue & 0x01) !== 0;
        return true;
      case 'SBUF': this.transmitSbuf(byteValue); return true;
      case 'IE':
        this.state.interrupts.IE = byteValue;
        this.state.interrupts.EA = (byteValue & 0x80) !== 0;
        this.state.interrupts.ES = (byteValue & 0x10) !== 0;
        this.state.interrupts.ET1 = (byteValue & 0x08) !== 0;
        this.state.interrupts.EX1 = (byteValue & 0x04) !== 0;
        this.state.interrupts.ET0 = (byteValue & 0x02) !== 0;
        this.state.interrupts.EX0 = (byteValue & 0x01) !== 0;
        return true;
      case 'IP': this.state.interrupts.IP = byteValue; return true;
      case 'PSW': this.setPSWValue(byteValue); return true;
      case 'ACC':
        this.state.registers.A = byteValue;
        this.updateParity();
        return true;
      case 'B': this.state.registers.B = byteValue; return true;
      case 'T2CON':
      case 'RCAP2L':
      case 'RCAP2H':
      case 'TL2':
      case 'TH2':
        return true;
      default:
        return false;
    }
  }

  private isBitOperand(operand: string | undefined): boolean {
    if (!operand) return false;
    const resolved = this.resolveSymbol(operand);
    const upper = resolved.toUpperCase();
    if (/^P[0-3]\.[0-7]$/.test(upper)) return true;
    const sfrBitMatch = upper.match(/^([A-Z]\w*)\.([0-7])$/);
    if (sfrBitMatch) {
      const sfrAddr = this.sfrNameToAddr.get(sfrBitMatch[1]);
      if (sfrAddr !== undefined && (sfrAddr & 0x07) === 0) return true;
    }
    if (this.parseRamBitOperand(upper)) return true; // RAM 位寻址区 dot 写法（如 24H.0）
    if ([
      'CY', 'C', 'AC', 'F0', 'RS1', 'RS0', 'OV', 'P',
      'TI', 'RI', 'TR0', 'TR1', 'TF0', 'TF1',
      'EA', 'ET0', 'ET1', 'EX0', 'EX1', 'ES',
      'IT0', 'IE0', 'IT1', 'IE1',
    ].includes(upper)) {
      return true;
    }

    const bitNum = this.parseNumber(upper);
    if (Number.isNaN(bitNum) || bitNum < 0 || bitNum > 0xFF) return false;
    return bitNum <= 0x7F || this.sfrMap.has(bitNum & 0xF8);
  }

  /**
   * 解析 "NNH.b" 形式的内部 RAM 位操作数（仅 0x20-0x2F 位寻址区），如 24H.0、22H.0。
   * 实验代码大量使用这种写法（JB 24H.0 / CPL 22H.0 / MOV C,21H.0），
   * 此前会被静默忽略，导致蜂鸣器开关、电机运行标志等位操作全部失效。
   */
  private parseRamBitOperand(upper: string): { addr: number; bit: number } | null {
    const m = upper.match(/^([0-9A-F]+H|\d+)\.([0-7])$/i);
    if (!m) return null;
    const addr = this.parseNumber(m[1]);
    if (Number.isNaN(addr) || addr < 0x20 || addr > 0x2f) return null;
    return { addr, bit: parseInt(m[2], 10) };
  }

  /** Resolve EQU/BIT/DATA symbols in an operand string */
  private resolveSymbol(operand: string): string {
    if (!operand) return operand;
    // Don't resolve if it's a register, immediate, or known SFR
    const upper = operand.toUpperCase();
    if (this.symbols.has(upper)) {
      return this.symbols.get(upper)!;
    }
    // For immediate values, resolve the value part: #SYMBOL → #value
    if (operand.startsWith('#') && this.symbols.has(operand.substring(1).toUpperCase())) {
      return '#' + this.symbols.get(operand.substring(1).toUpperCase())!;
    }
    return operand;
  }

  /** Parse a character literal like 'A' to its ASCII value */
  private parseCharLiteral(s: string): number | null {
    const m = s.match(/^'(.)'$/);
    if (m) return m[1].charCodeAt(0);
    return null;
  }

  private parseCode(): void {
    if (!this.code) return;
    const lines = this.code.split('\n');
    let currentAddress = 0; // Track current memory address
    this.codeMemory.fill(0);

    // Pass 0: Collect EQU/BIT/DATA symbol definitions
    lines.forEach((line) => {
      const cleaned = line.replace(/;.*$/, '').trim();
      if (!cleaned) return;
      // Match: NAME EQU value | NAME BIT addr | NAME DATA addr
      const symMatch = cleaned.match(/^([A-Z_]\w*)\s+(?:EQU|BIT|DATA)\s+(.+)$/i);
      if (symMatch) {
        this.symbols.set(symMatch[1].toUpperCase(), symMatch[2].trim());
      }
    });

    lines.forEach((line, index) => {
      const cleanedLine = line.replace(/;.*$/, '').trim(); // Remove comments and trim
      if (!cleanedLine) return;

      // Skip EQU/BIT/DATA definitions (already handled in pass 0)
      if (/^[A-Z_]\w*\s+(?:EQU|BIT|DATA)\s+/i.test(cleanedLine)) return;

      // Handle lines that contain only a label (e.g., "MAIN:")
      if (/^\w+:$/.test(cleanedLine)) {
        const soloLabel = cleanedLine.slice(0, -1); // Remove trailing ':'
        this.labels.set(soloLabel, currentAddress);
        return; // No instruction on this line
      }

      const match = cleanedLine.match(/^(\w+:)?\s*(\w+)\s*(.*)$/);
      if (!match) return;

      const [, label, mnemonic, operandsStr] = match;
      if (!mnemonic) return;

      const operands = operandsStr ? operandsStr.split(',').map(op => op.trim()).filter(Boolean) : [];

      const dirUpper = mnemonic.toUpperCase();
      if (dirUpper === 'ORG') {
        if (operands[0]) {
          const parsedAddress = this.parseNumber(operands[0]);
          if (!Number.isNaN(parsedAddress)) {
            currentAddress = parsedAddress & 0xFFFF;
          }
        }
        return; // ORG is a directive, not an instruction
      }

      // DB directive — store bytes in code memory
      if (dirUpper === 'DB') {
        if (label) {
          this.labels.set(label.slice(0, -1), currentAddress);
        }
        // Parse DB operands: hex, decimal, binary numbers, character literals, strings
        const rawData = operandsStr || '';
        const items = this.parseDBOperands(rawData);
        for (const b of items) {
          this.codeMemory[currentAddress++] = b & 0xFF;
        }
        return;
      }

      // DW directive — store 16-bit words in code memory (big-endian)
      if (dirUpper === 'DW') {
        if (label) {
          this.labels.set(label.slice(0, -1), currentAddress);
        }
        for (const op of operands) {
          const val = this.parseNumber(op);
          const word = Number.isNaN(val) ? 0 : val;
          this.codeMemory[currentAddress++] = (word >> 8) & 0xFF; // High byte first
          this.codeMemory[currentAddress++] = word & 0xFF;        // Low byte
        }
        return;
      }

      // DS directive — reserve space
      if (dirUpper === 'DS') {
        if (label) {
          this.labels.set(label.slice(0, -1), currentAddress);
        }
        const parsedSize = operands[0] ? this.parseNumber(operands[0]) : 1;
        const size = Number.isNaN(parsedSize) || parsedSize < 0 ? 1 : parsedSize;
        currentAddress += size;
        return;
      }

      // END directive marks end of source – but we still need to track it as an instruction
      if (dirUpper === 'END') {
        if (label) {
          this.labels.set(label.slice(0, -1), currentAddress);
        }

        const instruction = {
          mnemonic: 'END',
          operands: [] as string[],
          line: index,
          address: currentAddress,
        };
        this.instructions.push(instruction);
        this.instructionMap.set(currentAddress, instruction);

        // Add instruction text to memory array for UI display
        this.state.memory.push('END');

        currentAddress += 1; // END instruction takes 1 byte
        return;
      }

      if (label) {
        this.labels.set(label.slice(0, -1), currentAddress);
      }

      // Determine instruction length more accurately
      let instructionLength = 1; // Default to 1 byte (for single-byte instructions)

      if (['NOP', 'RET', 'RETI', 'ACALL', 'LCALL', 'AJMP', 'LJMP', 'SJMP', 'JMP', 'JZ', 'JNZ', 'JC', 'JNC', 'JB', 'JNB', 'JBC', 'DJNZ', 'CJNE', 'DA', 'SWAP', 'XCH', 'XCHD', 'ADD', 'ADDC', 'SUBB', 'ANL', 'ORL', 'XRL', 'CLR', 'CPL', 'RL', 'RLC', 'RR', 'RRC', 'INC', 'DEC', 'MUL', 'DIV', 'MOV', 'PUSH', 'POP', 'SETB', 'MOVX'].includes(dirUpper)) {
        switch (dirUpper) {
          case 'ACALL':
            instructionLength = 2;
            break;
          case 'LCALL':
          case 'LJMP':
            instructionLength = 3;
            break;
          case 'AJMP':
          case 'SJMP':
          case 'JZ':
          case 'JNZ':
          case 'JC':
          case 'JNC':
            instructionLength = 2; // 2-byte relative jump
            break;
          case 'JB':
          case 'JNB':
          case 'JBC':
            instructionLength = 3; // 3-byte: opcode + bit addr + rel offset
            break;
          case 'CJNE':
            instructionLength = 3; // CJNE is 3 bytes (operand, immediate, rel addr)
            break;
          case 'MOV':
            // 与执行期共用同一长度函数，保证地址分配与 PC 推进永远一致
            if (operands.length === 2 && operands[0] && operands[1]) {
              instructionLength = this.getMovLength(operands[0], operands[1]);
            }
            break;
          case 'SETB':
          case 'CLR':
          case 'CPL':
            if (!operands[0]) break;
            {
              const bitOp = operands[0].toUpperCase();
              // SETB C / CLR C / CPL C = 1 byte; CLR A / CPL A = 1 byte
              if (bitOp === 'C' || bitOp === 'CY') {
                instructionLength = 1;
              } else if ((dirUpper === 'CLR' || dirUpper === 'CPL') && (bitOp === 'A' || bitOp === 'ACC')) {
                instructionLength = 1;
              } else {
                instructionLength = 2; // All other bit targets are 2-byte
              }
            }
            break;
          case 'DJNZ':
            // DJNZ reg, rel (2 bytes) or DJNZ direct, rel (3 bytes)
            instructionLength = operands[0] && operands[0].match(/^R[0-7]$/i) ? 2 : 3;
            break;
          case 'PUSH':
          case 'POP':
            instructionLength = 2;
            break;
          case 'ADD':
          case 'ADDC':
          case 'SUBB':
            // ADD A, Rn = 1; ADD A, @Ri = 1; ADD A, #data = 2; ADD A, direct = 2
            if (operands[1]) {
              const s = operands[1].toUpperCase();
              instructionLength = (s.match(/^R[0-7]$/i) || s.match(/^@R[01]$/i)) ? 1 : 2;
            }
            break;
          case 'ANL':
          case 'ORL':
          case 'XRL':
            if (operands[0] && operands[1]) {
              const d = operands[0].toUpperCase();
              const s = operands[1].toUpperCase();
              if (d === 'A') {
                instructionLength = (s.match(/^R[0-7]$/i) || s.match(/^@R[01]$/i)) ? 1 : 2;
              } else {
                instructionLength = s.startsWith('#') ? 3 : 2;
              }
            }
            break;
          case 'INC':
          case 'DEC':
            if (operands[0]) {
              const o = operands[0].toUpperCase();
              instructionLength = (o === 'A' || o === 'DPTR' || o.match(/^R[0-7]$/) || o.match(/^@R[01]$/)) ? 1 : 2;
            }
            break;
          case 'XCH':
          case 'XCHD':
            // XCH A, Rn = 1; XCH A, @Ri = 1; XCH A, direct = 2
            if (operands[1]) {
              const s = operands[1].toUpperCase();
              instructionLength = (s.match(/^R[0-7]$/i) || s.match(/^@R[01]$/i)) ? 1 : 2;
            }
            break;
          case 'MOVC':
          case 'MOVX':
            instructionLength = 1;
            break;
          default:
            instructionLength = 1;
        }
      }

      // Handle '$' operand (current address) — replace with auto-generated label
      for (let oi = 0; oi < operands.length; oi++) {
        if (operands[oi] === '$') {
          const autoLabel = `__SELF_${currentAddress}__`;
          this.labels.set(autoLabel, currentAddress);
          operands[oi] = autoLabel;
        }
      }

      const instruction = {
        mnemonic: mnemonic.toUpperCase(),
        operands,
        line: index,
        address: currentAddress,
      };
      this.instructions.push(instruction);
      this.instructionMap.set(currentAddress, instruction);

      // Add instruction text to memory array for UI display
      const instructionText = operands.length > 0
        ? `${mnemonic.toUpperCase()} ${operands.join(', ')}`
        : mnemonic.toUpperCase();
      this.state.memory.push(instructionText);

      currentAddress += instructionLength;
    });
    // Set PC to the first instruction's address, or 0 if no instructions
    if (this.instructions.length > 0) {
      this.state.pc = this.instructions[0]?.address ?? 0;
    } else {
      this.state.pc = 0;
    }
  }

  public step(): SimulatorState {
    this.stepRaw();
    return this.getState();
  }

  /**
   * 执行单条指令，不做状态深拷贝（getState 的 JSON 深拷贝很贵）。
   * 供 step() 与 stepBatch() 复用，是实时动画运行的性能关键路径。
   */
  private stepRaw(): void {
    if (this.state.terminated) {
      return;
    }

    // 单步模式不做自动循环检测 — 让用户自行控制
    // 循环检测仅在 simulate() 的全速执行中进行

    // Find the instruction at the current PC (optimized lookup)
    const instr = this.instructionMap.get(this.state.pc);

    if (!instr) {
        // 检查是否PC超出了有效范围
        const maxAddress = Math.max(...Array.from(this.instructionMap.keys()));
        if (this.state.pc > maxAddress) {
          this.state.terminated = true;
          return;
        }

        // 尝试查找最近的有效指令
        let nearestPC = this.state.pc;
        for (let offset = 1; offset <= 10; offset++) {
          if (this.instructionMap.has(this.state.pc + offset)) {
            nearestPC = this.state.pc + offset;
            break;
          }
          if (this.instructionMap.has(this.state.pc - offset)) {
            nearestPC = this.state.pc - offset;
            break;
          }
        }

        if (nearestPC !== this.state.pc && this.instructionMap.has(nearestPC)) {
          this.state.pc = nearestPC;
          const nearestInstr = this.instructionMap.get(nearestPC);
          if (nearestInstr) {
            this.execute(nearestInstr);
            this.afterInstruction(nearestInstr);
            return;
          }
        }

        this.state.terminated = true;
        return;
    }

    this.execute(instr);
    this.afterInstruction(instr);
  }

  /**
   * 批量连续执行至多 count 条指令，或直到程序终止。
   * 不做深拷贝、不做 simulate() 里那种"检测到重复周期即终止"的判定——
   * 因为对 LED 闪烁 / 方波这类稳态循环，我们要它持续运行以驱动实时动画，
   * 由前端每帧调用一次、并在其后取一次 getState() 刷新 UI。
   */
  public stepBatch(count: number, breakpointLines?: Set<number>): { terminated: boolean; executed: number; hitBreakpoint: boolean } {
    const cap = Math.max(1, Math.min(Math.floor(count) || 1, 200000));
    const checkBp = !!breakpointLines && breakpointLines.size > 0;
    let executed = 0;
    for (let i = 0; i < cap; i++) {
      if (this.state.terminated) break;
      this.stepRaw();
      executed++;
      if (this.state.terminated) break;
      if (checkBp) {
        // 即将执行的下一条指令是否落在断点行（instruction.line 为 0 基，断点行为 1 基）
        const next = this.instructionMap.get(this.state.pc);
        if (next && breakpointLines!.has(next.line + 1)) {
          return { terminated: false, executed, hitBreakpoint: true };
        }
      }
    }
    return { terminated: this.state.terminated, executed, hitBreakpoint: false };
  }

  /**
   * 每执行完一条指令后调用：推进定时器、按需派发中断。
   * 让定时器/中断类实验（方波、数码管动态扫描、定时中断）真正产生可观察的行为。
   */
  private afterInstruction(instr: Instruction): void {
    // Classic 12T 8051 instruction timing. The source parser is a teaching model,
    // so this accounts for opcode machine cycles but not board oscillator tolerance.
    const cycles = this.machineCyclesFor(instr);
    this.instrCount += cycles;
    this.state.machineCycles += cycles;
    if (this.state.buzzer.active && this.instrCount - this.lastBuzzerToggleAt > 50000) {
      this.state.buzzer.active = false;
      this.state.buzzer.frequency = 0;
    }
    if (this.pendingPulses.length > 0) {
      for (const p of this.pendingPulses) p.remaining -= cycles;
      const expired = this.pendingPulses.filter(p => p.remaining <= 0);
      for (const p of expired) this.setPortBit(p.port, p.bit, true);
      this.pendingPulses = this.pendingPulses.filter(p => p.remaining > 0);
    }
    for (let cycle = 0; cycle < cycles; cycle++) this.tickTimers();
    this.dispatchInterrupts();
  }

  private machineCyclesFor(instr: Instruction): number {
    const mnemonic = instr.mnemonic;
    if (mnemonic === 'MUL' || mnemonic === 'DIV') return 4;
    if (['LJMP', 'LCALL', 'AJMP', 'ACALL', 'SJMP', 'JMP', 'RET', 'RETI',
      'DJNZ', 'CJNE', 'JZ', 'JNZ', 'JC', 'JNC', 'JB', 'JNB', 'JBC',
      'MOVX', 'MOVC', 'PUSH', 'POP', 'INC'].includes(mnemonic)) {
      return mnemonic === 'INC' && instr.operands[0]?.toUpperCase() !== 'DPTR' ? 1 : 2;
    }
    if (mnemonic === 'MOV') {
      const [dest, source] = instr.operands.map(op => op.toUpperCase());
      if (dest === 'DPTR') return 2;
      if (/^R[0-7]$/.test(dest || '') && source && !source.startsWith('#') && source !== 'A') return 2;
      if (dest && !/^(A|ACC|B|R[0-7]|@R[01])$/.test(dest) && source && !['A', 'ACC'].includes(source)) return 2;
      if (/^@R[01]$/.test(dest || '') && source && !source.startsWith('#') && source !== 'A') return 2;
    }
    return 1;
  }

  /**
   * 外部输入：改写某端口位的锁存电平（幂等），供画布按键"按下拉低、松开回高"。
   * 只动 portValues，不触碰执行引擎——程序里的 MOV A,P3 / JNB P3.x 会读到新电平。
   */
  public setPortBit(port: 'P0' | 'P1' | 'P2' | 'P3', bit: number, level: boolean): void {
    if (!['P0', 'P1', 'P2', 'P3'].includes(port) || !Number.isInteger(bit) || bit < 0 || bit > 7 || typeof level !== 'boolean') return;
    const wasHigh = (this.state.portValues[port] & (1 << bit)) !== 0;
    if (level) {
      this.state.portValues[port] |= (1 << bit);
    } else {
      this.state.portValues[port] &= ~(1 << bit);
    }
    // INT0/INT1 的下降沿由外部输入产生；电平触发在指令边界读取。
    if (port === 'P3' && wasHigh && !level && (bit === 2 || bit === 3)) {
      const modeBit = bit === 2 ? 0x01 : 0x04;
      if (this.state.timers.TCON & modeBit) this.state.timers.TCON |= modeBit << 1;
    }
  }

  /**
   * 模拟一次瞬时按键：把端口位拉低 durationInstr 条指令（模型时间 ≈ 同数值 µs）后自动回高。
   * 时长按指令数计而非墙钟，保证在任何运行速度下都短于实验代码里的消抖延时循环，
   * 单击只触发一次（与真实硬件快速点按一致）。
   */
  public pulsePortBit(port: 'P0' | 'P1' | 'P2' | 'P3', bit: number, durationInstr: number = 2500): void {
    if (!['P0', 'P1', 'P2', 'P3'].includes(port) || !Number.isInteger(bit) || bit < 0 || bit > 7
      || !Number.isSafeInteger(durationInstr) || durationInstr < 1 || durationInstr > 200000) return;
    this.setPortBit(port, bit, false);
    const existing = this.pendingPulses.find(p => p.port === port && p.bit === bit);
    if (existing) {
      existing.remaining = Math.max(existing.remaining, durationInstr);
    } else {
      this.pendingPulses.push({ port, bit, remaining: durationInstr });
    }
  }

  /** 单字节模拟串口接收；由原程序读取 SBUF 和清除 RI，不直接改写应用变量。 */
  public receiveUartByte(value: number): boolean {
    const uart = this.state.uart;
    if (!Number.isInteger(value) || value < 0 || value > 255 || this.state.terminated
      || !(uart.SCON & 0x10) || uart.RI || this.inInterrupt) return false;
    uart.SBUF = value;
    this.receivedSbuf = value;
    uart.RI = true;
    uart.SCON |= 0x01;
    uart.receiveBuffer = (uart.receiveBuffer + String.fromCharCode(value)).slice(-4000);
    return true;
  }

  /** 声明蜂鸣器输出引脚（来自实验配置，如 exp07 的 P2.0），跨 reset/updateCode 保持 */
  public setBuzzerPin(pin: string | null): void {
    this.buzzerPin = pin;
    if (pin) this.state.buzzer.outputPin = pin;
  }

  /**
   * 蜂鸣器引脚电平翻转记录：由相邻两次翻转的指令间隔推算方波频率。
   * 经典12T模型 1 机器周期=1µs（12MHz），故 f = 1e6 / (2×间隔)。间隔是
   * 仿真执行的产物（定时器溢出→中断→CPL 引脚），不是预设值。
   */
  private recordBuzzerToggle(): void {
    if (this.lastBuzzerToggleAt >= 0) {
      const interval = this.instrCount - this.lastBuzzerToggleAt;
      if (interval > 0) {
        this.state.buzzer.frequency = Math.round(1e6 / (2 * interval));
        this.state.buzzer.active = true;
      }
    }
    this.lastBuzzerToggleAt = this.instrCount;
  }

  /**
   * 写 SBUF = 启动一次发送：字符进入发送缓冲区、发送完成置 TI（教学简化：立即完成）。
   * 这让轮询 JNB TI 的发送子程序能正常推进，终端视图直接渲染 transmitBuffer。
   * 注：只置 TI 标志（JNB/JB TI 走命名位读取），不回写 SCON.1 镜像位，
   * 保持 MOV SBUF 对 SCON 字节的既有语义（存量用例依赖）。
   */
  private transmitSbuf(value: number): void {
    const u = this.state.uart;
    u.SBUF = value & 0xFF;
    u.transmitBuffer += String.fromCharCode(value & 0xFF);
    if (u.transmitBuffer.length > 4000) u.transmitBuffer = u.transmitBuffer.slice(-4000);
    u.TI = true;
    u.dataTransmitting = true;
  }

  /**
   * 定时器按经典12T指令机器周期推进（不含外部硬件误差）。
   * 支持方式1（16位）与方式2（8位自动重装）；溢出置 TFx，供轮询或中断使用。
   */
  private tickTimers(): void {
    const t = this.state.timers;
    if (t.TR0) this.tickTimer(0, t.TMOD & 0x03);
    if (t.TR1) this.tickTimer(1, (t.TMOD >> 4) & 0x03);
  }

  private tickTimer(n: 0 | 1, mode: number): void {
    const t = this.state.timers;
    const THk = n === 0 ? 'TH0' : 'TH1';
    const TLk = n === 0 ? 'TL0' : 'TL1';
    if (mode === 2) {
      // 方式2：8位自动重装，TL 溢出后从 TH 重装
      const next = t[TLk] + 1;
      if (next > 0xff) {
        t[TLk] = t[THk] & 0xff;
        this.setTimerOverflow(n);
      } else {
        t[TLk] = next & 0xff;
      }
    } else {
      // 方式0/1：按16位计数（方式0的13位在教学里按16位近似处理）
      let val = ((t[THk] << 8) | t[TLk]) & 0xffff;
      val += 1;
      if (val > 0xffff) {
        t[THk] = 0;
        t[TLk] = 0;
        this.setTimerOverflow(n);
      } else {
        t[THk] = (val >> 8) & 0xff;
        t[TLk] = val & 0xff;
      }
    }
  }

  private setTimerOverflow(n: 0 | 1): void {
    const t = this.state.timers;
    if (n === 0) { t.TF0 = true; t.overflowCount0++; }
    else { t.TF1 = true; t.overflowCount1++; }
  }

  /**
   * 中断派发：在指令边界检查已使能且已挂起的中断，压入 PC 并跳转到中断向量。
   * 简化模型：不支持中断嵌套（inInterrupt 阻止重入），优先级按固定自然顺序。
   * 定时器中断被响应时自动清除对应 TFx（与硬件一致）。
   */
  private dispatchInterrupts(): void {
    const it = this.state.interrupts;
    const t = this.state.timers;
    if (!it.EA || this.inInterrupt) return;

    // 自然优先级：外部0 → 定时器0 → 外部1 → 定时器1 → 串口。
    // 下降沿触发在受理时清标志；低电平触发在输入保持低时可再次受理。
    const externalPending = (number: 0 | 1): boolean => {
      const modeBit = number === 0 ? 0x01 : 0x04;
      return (t.TCON & modeBit) !== 0
        ? (t.TCON & (modeBit << 1)) !== 0
        : (this.state.portValues.P3 & (1 << (number + 2))) === 0;
    };
    if (it.EX0 && externalPending(0)) { t.TCON &= ~0x02; this.enterInterrupt(0x0003); return; }
    if (it.ET0 && t.TF0) { t.TF0 = false; this.enterInterrupt(0x000b); return; }
    if (it.EX1 && externalPending(1)) { t.TCON &= ~0x08; this.enterInterrupt(0x0013); return; }
    if (it.ET1 && t.TF1) { t.TF1 = false; this.enterInterrupt(0x001b); return; }
    if (it.ES && (this.state.uart.RI || this.state.uart.TI)) this.enterInterrupt(0x0023);
  }

  private enterInterrupt(vector: number): void {
    this.pushToStack16(this.state.pc); // 压入返回地址（当前 PC）
    this.inInterrupt = true;
    this.state.pc = vector & 0xffff;
  }

  /** Step with full diff trace for execution visualization */
  public stepWithTrace(): { state: SimulatorState; trace: ExecutionTraceEntry } {
    // Snapshot before execution
    const prevPC = this.state.pc;
    const prevRegs: Record<string, number> = {};
    for (const key of ['A', 'B', 'SP', 'DPL', 'DPH', 'R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7']) {
      prevRegs[key] = this.state.registers[key] || 0;
    }
    const prevRam = this.state.ram.slice(0, 128); // Only internal RAM
    const prevPorts = { ...this.state.portValues };
    const prevPSW = { ...this.state.psw };

    // Get instruction text before executing
    const instr = this.instructionMap.get(this.state.pc);
    const instrText = instr
      ? `${instr.mnemonic} ${instr.operands.join(', ')}`.trim()
      : '???';
    const instrLine = instr?.line ?? -1;

    // Execute
    const state = this.step();
    this.stepCount++;

    // Diff registers
    const regChanges: ExecutionTraceEntry['regChanges'] = [];
    for (const key of ['A', 'B', 'SP', 'DPL', 'DPH', 'R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7']) {
      const now = this.state.registers[key] || 0;
      if (now !== prevRegs[key]) {
        regChanges.push({ name: key, from: prevRegs[key], to: now });
      }
    }
    // PC change
    if (this.state.pc !== prevPC) {
      regChanges.push({ name: 'PC', from: prevPC, to: this.state.pc });
    }

    // Diff RAM
    const memChanges: ExecutionTraceEntry['memChanges'] = [];
    for (let i = 0; i < 128; i++) {
      if (this.state.ram[i] !== prevRam[i]) {
        memChanges.push({ addr: i, from: prevRam[i], to: this.state.ram[i] });
      }
    }

    // Diff ports
    const portChanges: ExecutionTraceEntry['portChanges'] = [];
    for (const p of ['P0', 'P1', 'P2', 'P3'] as const) {
      if (this.state.portValues[p] !== prevPorts[p]) {
        portChanges.push({ port: p, from: prevPorts[p], to: this.state.portValues[p] });
      }
    }

    // Diff PSW flags
    const flagChanges: ExecutionTraceEntry['flagChanges'] = [];
    for (const f of ['CY', 'AC', 'F0', 'RS1', 'RS0', 'OV', 'P'] as const) {
      if (this.state.psw[f] !== prevPSW[f]) {
        flagChanges.push({ flag: f, from: prevPSW[f], to: this.state.psw[f] });
      }
    }

    const trace: ExecutionTraceEntry = {
      step: this.stepCount,
      pc: prevPC,
      instruction: instrText,
      line: instrLine,
      regChanges,
      memChanges,
      portChanges,
      flagChanges,
    };

    return { state, trace };
  }

  /**
   * 运行程序，解析代码并执行
   * @param code 汇编代码
   * @returns Promise<SimulatorState> 执行后的状态
   */
  public async run(code: string): Promise<SimulatorState> {
    try {
      // 更新代码并重新解析
      this.updateCode(code);

      // 如果没有指令，返回初始状态
      if (this.instructions.length === 0) {
        return this.getState();
      }

      // 执行程序
      this.simulate();

      // 返回完整的状态
      return this.getState();
    } catch (error) {
      this.state.terminated = true;
      throw error;
    }
  }

  private execute(instr: Instruction): void {
    // Placeholder for execution logic
    // Removed console.log for performance - was logging every instruction

    switch (instr.mnemonic) {
      case 'MOV':
        this.executeMOV(instr.operands);
        break;
      case 'ACALL':
        this.executeACALL(instr.operands);
        break;
      case 'RET':
        this.executeRET();
        break;
      case 'DJNZ':
        this.executeDJNZ(instr.operands);
        break;
      case 'CJNE':
        this.executeCJNE(instr.operands);
        break;
      case 'RL':
        this.executeRL(instr.operands);
        break;
      case 'RR':
        this.executeRR(instr.operands);
        break;
      case 'SETB':
        this.executeSETB(instr.operands);
        break;
      case 'CLR':
        this.executeCLR(instr.operands);
        break;
      case 'CPL':
        this.executeCPL(instr.operands);
        break;
      case 'ADD':
        this.executeADD(instr.operands);
        break;
      case 'ADDC':
        this.executeADDC(instr.operands);
        break;
      case 'SUBB':
        this.executeSUBB(instr.operands);
        break;
      case 'DA':
        this.executeDA(instr.operands);
        break;
      case 'SWAP':
        this.executeSWAP(instr.operands);
        break;
      case 'XCH':
        this.executeXCH(instr.operands);
        break;
      case 'XCHD':
        this.executeXCHD(instr.operands);
        break;
      case 'RLC':
        this.executeRLC(instr.operands);
        break;
      case 'RRC':
        this.executeRRC(instr.operands);
        break;
      case 'ANL':
        this.executeANL(instr.operands);
        break;
      case 'ORL':
        this.executeORL(instr.operands);
        break;
      case 'XRL':
        this.executeXRL(instr.operands);
        break;
      case 'PUSH':
        this.executePUSH(instr.operands);
        break;
      case 'POP':
        this.executePOP(instr.operands);
        break;
      case 'MOVC':
        this.executeMOVC(instr.operands);
        break;
      case 'SJMP':
        this.executeSJMP(instr.operands);
        break;
      case 'LJMP':
        this.executeLJMP(instr.operands);
        break;
      case 'LCALL':
        this.executeLCALL(instr.operands);
        break;
      case 'AJMP':
        this.executeAJMP(instr.operands);
        break;
      case 'JMP':
        this.executeJMP(instr.operands);
        break;
      case 'JZ':
        this.executeJZ(instr.operands);
        break;
      case 'JNZ':
        this.executeJNZ(instr.operands);
        break;
      case 'JC':
        this.executeJC(instr.operands);
        break;
      case 'JNC':
        this.executeJNC(instr.operands);
        break;
      case 'JB':
        this.executeJB(instr.operands);
        break;
      case 'JNB':
        this.executeJNB(instr.operands);
        break;
      case 'INC':
        this.executeINC(instr.operands);
        break;
      case 'DEC':
        this.executeDEC(instr.operands);
        break;
      case 'MUL':
        this.executeMUL(instr.operands);
        break;
      case 'DIV':
        this.executeDIV(instr.operands);
        break;
      case 'RETI':
        this.executeRETI();
        break;
      case 'JBC':
        this.executeJBC(instr.operands);
        break;
      case 'MOVX':
        this.executeMOVX(instr.operands);
        break;
      case 'END':
        this.executeEND();
        return;
      case 'NOP':
        this.state.pc++;
        break;
      default:
        throw new Error(`暂不支持指令 ${instr.mnemonic}（源代码第 ${instr.line + 1} 行）`);
    }
  }

  /**
   * Parse a numeric string in 8051 assembly format.
   * Rules (matching real assemblers):
   *  - Suffix H/h → hexadecimal  (e.g. 0FFH, 3CH)
   *  - Suffix B/b → binary       (e.g. 11111110B)
   *  - No suffix  → decimal      (e.g. 20, 100, 255)
   *  - Leading 0 before hex letter is normal (e.g. 0FEH)
   */
  /** Get the value of a bit-addressable location (e.g., P3.7, TI, CY) */
  private getBitValue(bitAddr: string): boolean {
    const upper = bitAddr.toUpperCase();
    // Port pins P0.0-P3.7
    const portMatch = upper.match(/^P([0-3])\.([0-7])$/);
    if (portMatch) {
      const port = `P${portMatch[1]}` as keyof typeof this.state.portValues;
      const bit = parseInt(portMatch[2], 10);
      return (this.state.portValues[port] & (1 << bit)) !== 0;
    }
    // SFR bit-dot notation (ACC.0, B.7, PSW.5, etc.)
    const sfrBitMatch = upper.match(/^([A-Z]\w*)\.([0-7])$/);
    if (sfrBitMatch) {
      const sfrAddr = this.sfrNameToAddr.get(sfrBitMatch[1]);
      if (sfrAddr !== undefined && (sfrAddr & 0x07) === 0) {
        const sfrValue = this.getSfrValueByName(sfrBitMatch[1]);
        if (sfrValue !== undefined) {
          return (sfrValue & (1 << parseInt(sfrBitMatch[2], 10))) !== 0;
        }
      }
    }
    // RAM 位寻址区 dot 写法（20H.0~2FH.7，如 JB 24H.0）
    const ramBit = this.parseRamBitOperand(upper);
    if (ramBit) {
      return (this.state.ram[ramBit.addr] & (1 << ramBit.bit)) !== 0;
    }
    // Named bits
    switch (upper) {
      case 'CY': case 'C': return this.state.psw.CY;
      case 'AC': return this.state.psw.AC;
      case 'F0': return this.state.psw.F0;
      case 'RS1': return this.state.psw.RS1;
      case 'RS0': return this.state.psw.RS0;
      case 'OV': return this.state.psw.OV;
      case 'P': return this.state.psw.P;
      case 'TI': return this.state.uart.TI;
      case 'RI': return this.state.uart.RI;
      case 'TR0': return this.state.timers.TR0;
      case 'TR1': return this.state.timers.TR1;
      case 'TF0': return this.state.timers.TF0;
      case 'TF1': return this.state.timers.TF1;
      case 'EA': return this.state.interrupts.EA;
      case 'ET0': return this.state.interrupts.ET0;
      case 'ET1': return this.state.interrupts.ET1;
      case 'EX0': return this.state.interrupts.EX0;
      case 'EX1': return this.state.interrupts.EX1;
      case 'ES': return this.state.interrupts.ES;
      case 'IT0': return (this.state.timers.TCON & 0x01) !== 0;
      case 'IE0': return (this.state.timers.TCON & 0x02) !== 0;
      case 'IT1': return (this.state.timers.TCON & 0x04) !== 0;
      case 'IE1': return (this.state.timers.TCON & 0x08) !== 0;
      default: {
        // Numeric bit address: 00H-7FH → RAM 20H-2FH, 80H-FFH → bit-addressable SFRs
        const bitNum = this.parseNumber(upper);
        if (!Number.isNaN(bitNum) && bitNum >= 0 && bitNum <= 0x7F) {
          const byteAddr = 0x20 + (bitNum >> 3);
          const bitPos = bitNum & 0x07;
          return (this.state.ram[byteAddr] & (1 << bitPos)) !== 0;
        }
        if (!Number.isNaN(bitNum) && bitNum >= 0x80 && bitNum <= 0xFF) {
          const sfrName = this.sfrMap.get(bitNum & 0xF8);
          const sfrValue = sfrName ? this.getSfrValueByName(sfrName) : undefined;
          if (sfrValue !== undefined) {
            return (sfrValue & (1 << (bitNum & 0x07))) !== 0;
          }
        }
        return false;
      }
    }
  }

  /** Set the value of a bit-addressable location */
  private setBitValue(bitAddr: string, value: boolean): void {
    const upper = bitAddr.toUpperCase();
    const portMatch = upper.match(/^P([0-3])\.([0-7])$/);
    if (portMatch) {
      const port = `P${portMatch[1]}` as keyof typeof this.state.portValues;
      const bit = parseInt(portMatch[2], 10);
      const before = (this.state.portValues[port] >> bit) & 1;
      if (value) {
        this.state.portValues[port] |= (1 << bit);
      } else {
        this.state.portValues[port] &= ~(1 << bit);
      }
      // 蜂鸣器引脚电平真实翻转（CPL/SETB/CLR）→ 记录一次振荡沿
      if (before !== (value ? 1 : 0) && upper === this.state.buzzer.outputPin.toUpperCase()) {
        this.recordBuzzerToggle();
      }
      return;
    }
    // SFR bit-dot notation (ACC.0, B.7, PSW.5, etc.)
    const sfrBitMatch = upper.match(/^([A-Z]\w*)\.([0-7])$/);
    if (sfrBitMatch) {
      const sfrAddr = this.sfrNameToAddr.get(sfrBitMatch[1]);
      if (sfrAddr !== undefined && (sfrAddr & 0x07) === 0) {
        const sfrValue = this.getSfrValueByName(sfrBitMatch[1]);
        if (sfrValue !== undefined) {
          const bitPos = parseInt(sfrBitMatch[2], 10);
          const nextValue = value ? (sfrValue | (1 << bitPos)) : (sfrValue & ~(1 << bitPos));
          this.setSfrValueByName(sfrBitMatch[1], nextValue);
        }
        return;
      }
    }
    // RAM 位寻址区 dot 写法（20H.0~2FH.7，如 CPL 22H.0 / SETB 24H.0）
    const ramBit = this.parseRamBitOperand(upper);
    if (ramBit) {
      if (value) {
        this.state.ram[ramBit.addr] |= (1 << ramBit.bit);
      } else {
        this.state.ram[ramBit.addr] &= ~(1 << ramBit.bit);
      }
      return;
    }
    // Named bits
    switch (upper) {
      case 'CY': case 'C': this.state.psw.CY = value; break;
      case 'AC': this.state.psw.AC = value; break;
      case 'F0': this.state.psw.F0 = value; break;
      case 'RS1': this.state.psw.RS1 = value; this.syncWorkingRegisterMirror(); break;
      case 'RS0': this.state.psw.RS0 = value; this.syncWorkingRegisterMirror(); break;
      case 'OV': this.state.psw.OV = value; break;
      case 'P': this.state.psw.P = value; break;
      case 'TI': this.state.uart.TI = value; if (value) this.state.uart.SCON |= 0x02; else this.state.uart.SCON &= ~0x02; break;
      case 'RI': this.state.uart.RI = value; if (value) this.state.uart.SCON |= 0x01; else this.state.uart.SCON &= ~0x01; break;
      case 'TR0': this.state.timers.TR0 = value; if (value) this.state.timers.TCON |= 0x10; else this.state.timers.TCON &= ~0x10; break;
      case 'TR1': this.state.timers.TR1 = value; if (value) this.state.timers.TCON |= 0x40; else this.state.timers.TCON &= ~0x40; break;
      case 'TF0': this.state.timers.TF0 = value; if (value) this.state.timers.TCON |= 0x20; else this.state.timers.TCON &= ~0x20; break;
      case 'TF1': this.state.timers.TF1 = value; if (value) this.state.timers.TCON |= 0x80; else this.state.timers.TCON &= ~0x80; break;
      case 'IT0': if (value) this.state.timers.TCON |= 0x01; else this.state.timers.TCON &= ~0x01; break;
      case 'IE0': if (value) this.state.timers.TCON |= 0x02; else this.state.timers.TCON &= ~0x02; break;
      case 'IT1': if (value) this.state.timers.TCON |= 0x04; else this.state.timers.TCON &= ~0x04; break;
      case 'IE1': if (value) this.state.timers.TCON |= 0x08; else this.state.timers.TCON &= ~0x08; break;
      case 'EA': this.state.interrupts.EA = value; if (value) this.state.interrupts.IE |= 0x80; else this.state.interrupts.IE &= ~0x80; break;
      case 'ET0': this.state.interrupts.ET0 = value; if (value) this.state.interrupts.IE |= 0x02; else this.state.interrupts.IE &= ~0x02; break;
      case 'ET1': this.state.interrupts.ET1 = value; if (value) this.state.interrupts.IE |= 0x08; else this.state.interrupts.IE &= ~0x08; break;
      case 'EX0': this.state.interrupts.EX0 = value; if (value) this.state.interrupts.IE |= 0x01; else this.state.interrupts.IE &= ~0x01; break;
      case 'EX1': this.state.interrupts.EX1 = value; if (value) this.state.interrupts.IE |= 0x04; else this.state.interrupts.IE &= ~0x04; break;
      case 'ES': this.state.interrupts.ES = value; if (value) this.state.interrupts.IE |= 0x10; else this.state.interrupts.IE &= ~0x10; break;
      default: {
        // Numeric bit address: 8051 bit addressing scheme.
        const bitNum = this.parseNumber(upper);
        if (!Number.isNaN(bitNum) && bitNum >= 0 && bitNum <= 0x7F) {
          const byteAddr = 0x20 + (bitNum >> 3);
          const bitPos = bitNum & 0x07;
          if (value) {
            this.state.ram[byteAddr] |= (1 << bitPos);
          } else {
            this.state.ram[byteAddr] &= ~(1 << bitPos);
          }
          return;
        }
        if (!Number.isNaN(bitNum) && bitNum >= 0x80 && bitNum <= 0xFF) {
          const sfrName = this.sfrMap.get(bitNum & 0xF8);
          const sfrValue = sfrName ? this.getSfrValueByName(sfrName) : undefined;
          if (sfrName && sfrValue !== undefined) {
            const bitMask = 1 << (bitNum & 0x07);
            const nextValue = value ? (sfrValue | bitMask) : (sfrValue & ~bitMask);
            this.setSfrValueByName(sfrName, nextValue);
          }
        }
        break;
      }
    }
  }

  /** Update the parity flag (P) based on accumulator — set if odd number of 1-bits */
  private updateParity(): void {
    let a = this.state.registers.A;
    let bits = 0;
    while (a) { bits += a & 1; a >>= 1; }
    this.state.psw.P = (bits & 1) === 1;
  }

  /** Parse DB operands: numbers, character literals, and quoted strings */
  private parseDBOperands(raw: string): number[] {
    const result: number[] = [];
    // Split respecting quoted strings
    let current = '';
    let inString = false;
    let stringChar = '';

    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (!inString && (ch === '"' || ch === "'")) {
        // Check if it's a character literal like 'A' (single char in single quotes)
        if (ch === "'" && i + 2 < raw.length && raw[i + 2] === "'") {
          result.push(raw.charCodeAt(i + 1));
          i += 2; // skip past closing quote
          continue;
        }
        inString = true;
        stringChar = ch;
        // Flush any pending number
        if (current.trim()) {
          const parsed = this.parseNumber(current.trim());
          result.push(Number.isNaN(parsed) ? 0 : parsed);
          current = '';
        }
        continue;
      }
      if (inString) {
        if (ch === stringChar) {
          inString = false;
          continue;
        }
        result.push(ch.charCodeAt(0));
        continue;
      }
      if (ch === ',') {
        if (current.trim()) {
          const parsed = this.parseNumber(current.trim());
          result.push(Number.isNaN(parsed) ? 0 : parsed);
        }
        current = '';
        continue;
      }
      current += ch;
    }
    if (current.trim() && !inString) {
      const parsed = this.parseNumber(current.trim());
      result.push(Number.isNaN(parsed) ? 0 : parsed);
    }
    return result;
  }

  /** Check if an operand is a direct address (SFR name, port, or hex address like 90H) */
  private isDirectAddress(op: string): boolean {
    const SFR_NAMES = [
      'P0', 'P1', 'P2', 'P3',
      'TMOD', 'TCON', 'TH0', 'TL0', 'TH1', 'TL1', 'TH2', 'TL2', 'T2CON',
      'SCON', 'SBUF', 'PCON',
      'IE', 'IP',
      'PSW', 'SP', 'DPL', 'DPH', 'B', 'ACC',
    ];
    const u = this.resolveSymbol(op).toUpperCase();
    if (SFR_NAMES.includes(u)) return true;
    const address = this.parseNumber(u);
    return !Number.isNaN(address) && address >= 0 && address <= 0xFF;
  }

  private parseNumber(s: string): number {
    const t = s.trim();
    if (!t) {
      return Number.NaN;
    }
    if (/^0x[0-9A-F]+$/i.test(t)) {
      return parseInt(t.substring(2), 16);
    }
    if (/^[0-9A-F]+H$/i.test(t)) {
      return parseInt(t.replace(/H$/i, ''), 16);
    }
    if (/^[01]+B$/i.test(t)) {
      return parseInt(t.replace(/B$/i, ''), 2);
    }
    if (/^\d+$/i.test(t)) {
      return parseInt(t, 10);
    }
    return Number.NaN;
  }

  private getValue(operand: string | undefined): number {
    if (!operand) return 0;

    // Resolve EQU/BIT/DATA symbols
    operand = this.resolveSymbol(operand);

    // Immediate addressing
    if (operand.startsWith('#')) {
        const inner = operand.substring(1);
        // Character literal: #'A'
        const charVal = this.parseCharLiteral(inner);
        if (charVal !== null) return charVal;
        const parsed = this.parseNumber(inner);
        return Number.isNaN(parsed) ? 0 : parsed;
    }

    // Indirect addressing (@R0, @R1)
    // 越界行为定义：本机为经典 8051（内部 RAM 仅 128 字节，无 52 子系列的高 128 字节），
    // @Ri 地址 >7FH 时读返回 0（Uint8Array 越界读 undefined 归零），与"无此存储器"一致
    if (operand.match(/^@R[01]$/i)) {
        const regName = operand.substring(1).toUpperCase();
        const address = this.getWorkingRegisterValue(regName);
        return this.state.ram[address] || 0;
    }

    // Register addressing
    const operandUpper = operand.toUpperCase();
    if (this.isWorkingRegisterName(operandUpper)) {
        return this.getWorkingRegisterValue(operandUpper);
    }
    if (operandUpper in this.state.registers) {
        return this.state.registers[operandUpper] || 0;
    }

    // Special SFR names
    const modeledSfrValue = this.getSfrValueByName(operandUpper);
    if (modeledSfrValue !== undefined) {
        return modeledSfrValue;
    }

    switch (operandUpper) {
        case 'P0': return this.state.portValues.P0;
        case 'P1': return this.state.portValues.P1;
        case 'P2': return this.state.portValues.P2;
        case 'P3': return this.state.portValues.P3;
        case 'TMOD': return this.state.timers.TMOD;
        case 'TCON': return this.state.timers.TCON;
        case 'TH0': return this.state.timers.TH0;
        case 'TL0': return this.state.timers.TL0;
        case 'TH1': return this.state.timers.TH1;
        case 'TL1': return this.state.timers.TL1;
        case 'SCON': return this.state.uart.SCON;
        case 'SBUF': return this.receivedSbuf ?? this.state.uart.SBUF;
        case 'IE': return this.state.interrupts.IE;
        case 'IP': return this.state.interrupts.IP;
        case 'ACC': return this.state.registers.A;
        case 'PSW': {
            let psw = 0;
            if (this.state.psw.CY) psw |= 0x80;
            if (this.state.psw.AC) psw |= 0x40;
            if (this.state.psw.F0) psw |= 0x20;
            if (this.state.psw.RS1) psw |= 0x10;
            if (this.state.psw.RS0) psw |= 0x08;
            if (this.state.psw.OV) psw |= 0x04;
            if (this.state.psw.P) psw |= 0x01;
            return psw;
        }
    }

    // Direct addressing or SFR by address
    const address = this.parseNumber(operand);
    if (!Number.isNaN(address) && address >= 0 && address <= 0xFF) {
        const sfrName = this.sfrMap.get(address);
        if (sfrName) {
            return this.getSfrValueByName(sfrName) ?? 0;
        } else if (address < 128) { // Internal RAM
            return this.state.ram[address] || 0;
        }
    }

    return 0;
  }

  private setValue(operand: string | undefined, value: number): void {
    if (!operand) return;
    value = value & 0xFF; // Ensure it's a byte

    // Resolve EQU/BIT/DATA symbols
    operand = this.resolveSymbol(operand);

    // Indirect addressing (@R0, @R1)
    // 越界行为定义：@Ri 地址 >7FH 的写入静默丢弃（经典 8051 无高 128 字节 RAM），
    // 有金标准测试固化此语义（simulator-golden.test.ts）
    if (operand.match(/^@R[01]$/i)) {
        const regName = operand.substring(1).toUpperCase();
        const address = this.getWorkingRegisterValue(regName);
        this.state.ram[address] = value;
        this.syncWorkingRegisterMirror();
        return;
    }

    // Register addressing
    const operandUpper = operand.toUpperCase();
    if (this.isWorkingRegisterName(operandUpper)) {
        this.setWorkingRegisterValue(operandUpper, value);
        return;
    }
    if (operandUpper in this.state.registers) {
        this.state.registers[operandUpper] = value;
        if (operandUpper === 'A') this.updateParity();
        return;
    }

    // Special SFR names
    if (this.setSfrValueByName(operandUpper, value)) {
        return;
    }

    switch (operandUpper) {
        case 'P0': this.state.portValues.P0 = value; return;
        case 'P1': this.state.portValues.P1 = value; return;
        case 'P2': this.state.portValues.P2 = value; return;
        case 'P3': this.state.portValues.P3 = value; return;
        case 'TMOD':
            this.state.timers.TMOD = value;
            return;
        case 'TCON':
            this.state.timers.TCON = value;
            // Update individual timer control bits
            this.state.timers.TR0 = (value & 0x10) !== 0;
            this.state.timers.TR1 = (value & 0x40) !== 0;
            this.state.timers.TF0 = (value & 0x20) !== 0;
            this.state.timers.TF1 = (value & 0x80) !== 0;
            return;
        case 'TH0':
            this.state.timers.TH0 = value;
            return;
        case 'TL0':
            this.state.timers.TL0 = value;
            return;
        case 'TH1':
            this.state.timers.TH1 = value;
            return;
        case 'TL1':
            this.state.timers.TL1 = value;
            return;
        case 'SCON':
            this.state.uart.SCON = value;
            // Update individual UART control bits
            this.state.uart.TI = (value & 0x02) !== 0;
            this.state.uart.RI = (value & 0x01) !== 0;
            return;
        case 'SBUF':
            this.transmitSbuf(value);
            return;
        case 'IE':
            this.state.interrupts.IE = value;
            // Update individual interrupt enable bits
            this.state.interrupts.EA = (value & 0x80) !== 0;
            this.state.interrupts.ES = (value & 0x10) !== 0;
            this.state.interrupts.ET1 = (value & 0x08) !== 0;
            this.state.interrupts.EX1 = (value & 0x04) !== 0;
            this.state.interrupts.ET0 = (value & 0x02) !== 0;
            this.state.interrupts.EX0 = (value & 0x01) !== 0;
            return;
        case 'IP':
            this.state.interrupts.IP = value;
            return;
        case 'ACC':
            this.state.registers.A = value;
            return;
        case 'PSW': {
            this.state.psw.CY = (value & 0x80) !== 0;
            this.state.psw.AC = (value & 0x40) !== 0;
            this.state.psw.F0 = (value & 0x20) !== 0;
            this.state.psw.RS1 = (value & 0x10) !== 0;
            this.state.psw.RS0 = (value & 0x08) !== 0;
            this.state.psw.OV = (value & 0x04) !== 0;
            this.state.psw.P = (value & 0x01) !== 0;
            return;
        }
    }

    // Port addressing (direct operand like P1)
    if (operandUpper.startsWith('P') && operand[1]) {
        const portNum = parseInt(operand[1], 10);
        if (portNum >= 0 && portNum <= 3) {
            this.state.portValues[`P${portNum}` as keyof typeof this.state.portValues] = value;
            return;
        }
    }

    // Direct addressing or SFR by address
    const address = this.parseNumber(operand);
    if (!Number.isNaN(address) && address >= 0 && address <= 0xFF) {
        const sfrName = this.sfrMap.get(address);
        if (sfrName) {
            this.setSfrValueByName(sfrName, value);
        } else if (address < 128) { // Internal RAM
            this.state.ram[address] = value;
            this.syncWorkingRegisterMirror();
        }
    }
  }

  private executeMOV(operands: string[]): void {
    if (operands.length !== 2) {
        this.state.pc++;
        return;
    }
    // Resolve symbols for both operands
    const dest = this.resolveSymbol(operands[0] || '');
    const src = this.resolveSymbol(operands[1] || '');
    if (!dest || !src) {
        this.state.pc++;
        return;
    }
    const destUpper = dest.toUpperCase();
    const srcUpper = src.toUpperCase();

    // Handle bit-level MOV: MOV C, bit | MOV bit, C
    if ((destUpper === 'C' || destUpper === 'CY') && this.isBitOperand(src)) {
      // MOV C, bit — read bit into CY
      const bitVal = this.getBitValue(src);
      this.state.psw.CY = bitVal;
      this.state.pc += 2;
      return;
    }
    if (this.isBitOperand(dest) && (srcUpper === 'C' || srcUpper === 'CY')) {
      // MOV bit, C — write CY to bit
      this.setBitValue(dest, this.state.psw.CY);
      this.state.pc += 2;
      return;
    }

    // Special case: MOV DPTR, #data16 — 16-bit immediate to DPTR
    if (destUpper === 'DPTR' && src.startsWith('#')) {
      let inner = src.substring(1);
      // Resolve symbol (e.g., #TAB → label address)
      const labelAddr = this.labels.get(inner);
      let val16: number;
      if (labelAddr !== undefined) {
        val16 = labelAddr;
      } else {
        inner = this.resolveSymbol(inner);
        const charVal = this.parseCharLiteral(inner);
        const parsed = charVal !== null ? charVal : this.parseNumber(inner);
        val16 = Number.isNaN(parsed) ? 0 : parsed;
      }
      this.state.registers.DPH = (val16 >> 8) & 0xFF;
      this.state.registers.DPL = val16 & 0xFF;
      this.state.pc += 3;
      return;
    }

    const value = this.getValue(src);
    this.setValue(dest, value);
    if (destUpper === 'A') this.updateParity();

    // 与解析期共用同一长度函数（见 getMovLength 注释）
    this.state.pc += this.getMovLength(operands[0] || '', operands[1] || '');
  }

  private executeACALL(operands: string[]): void {
    if (operands.length !== 1) {
      this.state.pc++;
      return;
    }
    const targetLabel = operands[0];
    if (!targetLabel) {
      this.state.pc += 2;
      return;
    }
    const targetPC = this.labels.get(targetLabel);
    if (targetPC !== undefined) {
      this.pushToStack16(this.state.pc + 2); // Push return address (PC + 2 for ACALL)
      this.state.pc = targetPC;
    } else {
      // If label not found, advance PC by instruction length (2 bytes for ACALL)
      this.state.pc += 2;
    }
  }

  private executeRET(): void {
    const returnAddress = this.popFromStack16();
    this.state.pc = returnAddress;
  }

  private executeDJNZ(operands: string[]): void {
    if (operands.length !== 2) {
      this.state.pc++;
      return;
    }
    const operand = operands[0];
    const targetLabel = operands[1];
    if (!operand || !targetLabel) {
      this.state.pc += 2;
      return;
    }
    let value = this.getValue(operand);
    value = (value - 1) & 0xFF;
    this.setValue(operand, value);

    const instructionLength = /^R[0-7]$/i.test(operand) ? 2 : 3; // DJNZ Rn,rel is 2 bytes; DJNZ direct,rel is 3 bytes

    if (value !== 0) {
      const targetPC = this.labels.get(targetLabel);
      if (targetPC !== undefined) {
        this.state.pc = targetPC;
      } else {
        this.state.pc += instructionLength; // Advance if label not found
      }
    } else {
      this.state.pc += instructionLength;
    }
  }

  private executeCJNE(operands: string[]): void {
    if (operands.length !== 3) {
      this.state.pc += 3; // CJNE is a 3-byte instruction
      return;
    }
    const op1 = operands[0];
    const op2 = operands[1];
    const targetLabel = operands[2];
    if (!op1 || !op2 || !targetLabel) {
      this.state.pc += 3;
      return;
    }

    const val1 = this.getValue(op1);
    const val2 = this.getValue(op2);

    // Real 8051: CY = 1 if unsigned val1 < val2, else CY = 0
    this.state.psw.CY = val1 < val2;

    if (val1 !== val2) {
      const targetPC = this.labels.get(targetLabel);
      if (targetPC !== undefined) {
        this.state.pc = targetPC;
      } else {
        this.state.pc += 3;
      }
    } else {
      this.state.pc += 3;
    }
  }

  private executeRL(operands: string[]): void {
    if (operands.length !== 1 || !operands[0] || operands[0].toUpperCase() !== 'A') {
      this.state.pc += 1; // RL is a 1-byte instruction
      return;
    }
    let value = this.state.registers.A;
    value = ((value << 1) | (value >> 7)) & 0xFF;
    this.state.registers.A = value;
    this.updateParity();
    this.state.pc += 1;
  }

  private executeRR(operands: string[]): void {
    if (operands.length !== 1 || !operands[0] || operands[0].toUpperCase() !== 'A') {
      this.state.pc += 1; // RR is a 1-byte instruction
      return;
    }
    let value = this.state.registers.A;
    value = ((value >> 1) | (value << 7)) & 0xFF;
    this.state.registers.A = value;
    this.updateParity();
    this.state.pc += 1;
  }

  private executeSETB(operands: string[]): void {
    if (operands.length !== 1) {
      this.state.pc += 1; // SETB is a 1-byte instruction
      return;
    }
    let operand = operands[0];
    if (!operand) {
      this.state.pc += 1;
      return;
    }
    operand = this.resolveSymbol(operand);

    const operandUpper = operand.toUpperCase();

    // Handle special control bits
    switch (operandUpper) {
      case 'C':
      case 'CY':
        this.state.psw.CY = true;
        this.state.pc += 1; // SETB C is 1-byte (opcode D3)
        return;
    }

    // All other SETB targets are 2-byte instructions (opcode D2 + bit address)
    this.setBitValue(operandUpper, true);
    this.state.pc += 2;
  }

  private executeCLR(operands: string[]): void {
    if (operands.length !== 1) {
      this.state.pc += 1; // CLR is a 1-byte instruction
      return;
    }
    let operand = operands[0];
    if (!operand) {
      this.state.pc += 1;
      return;
    }
    operand = this.resolveSymbol(operand);

    const operandUpper = operand.toUpperCase();

    // CLR A — clear accumulator (1-byte, opcode E4)
    if (operandUpper === 'A' || operandUpper === 'ACC') {
      this.state.registers.A = 0;
      this.updateParity();
      this.state.pc += 1;
      return;
    }

    // CLR C — clear carry (1-byte, opcode C3)
    if (operandUpper === 'C' || operandUpper === 'CY') {
      this.state.psw.CY = false;
      this.state.pc += 1;
      return;
    }

    // All other CLR targets are 2-byte instructions (opcode C2 + bit address)
    this.setBitValue(operandUpper, false);
    this.state.pc += 2;
  }

  private executeCPL(operands: string[]): void {
    if (operands.length !== 1) {
      this.state.pc += 1; // CPL is a 1-byte instruction
      return;
    }
    let operand = operands[0];
    if (!operand) {
      this.state.pc += 1;
      return;
    }
    operand = this.resolveSymbol(operand);
    const operandUpper = operand.toUpperCase();

    // CPL A — complement accumulator (1-byte, opcode F4)
    if (operandUpper === 'A') {
      this.state.registers.A = (~this.state.registers.A) & 0xFF;
      this.updateParity();
      this.state.pc += 1;
      return;
    }

    // CPL C — complement carry (1-byte, opcode B3)
    if (operandUpper === 'C' || operandUpper === 'CY') {
      this.state.psw.CY = !this.state.psw.CY;
      this.state.pc += 1;
      return;
    }

    // All other CPL targets are 2-byte instructions (opcode B2 + bit address)
    const current = this.getBitValue(operandUpper);
    this.setBitValue(operandUpper, !current);
    this.state.pc += 2;
  }

  private executePUSH(operands: string[]): void {
    if (operands.length !== 1) {
      this.state.pc += 2; // PUSH is a 2-byte instruction
      return;
    }
    const operand = operands[0];
    const value = this.getValue(operand);
    this.pushToStack(value);
    this.state.pc += 2; // PUSH is a 2-byte instruction
  }

  private executePOP(operands: string[]): void {
    if (operands.length !== 1) {
      this.state.pc += 2; // POP is a 2-byte instruction
      return;
    }
    const operand = operands[0];
    const value = this.popFromStack();
    this.setValue(operand, value);
    this.state.pc += 2; // POP is a 2-byte instruction
  }

  private pushToStack(value: number): void {
    // For 8-bit values, just push the value
    this.state.registers.SP = (this.state.registers.SP + 1) & 0xFF;
    this.state.ram[this.state.registers.SP] = value & 0xFF;
    this.syncWorkingRegisterMirror();
  }

  private pushToStack16(value: number): void {
    // For 16-bit values (like return addresses), push low byte first, then high byte
    // Push low byte
    this.state.registers.SP = (this.state.registers.SP + 1) & 0xFF;
    this.state.ram[this.state.registers.SP] = value & 0xFF;
    // Push high byte
    this.state.registers.SP = (this.state.registers.SP + 1) & 0xFF;
    this.state.ram[this.state.registers.SP] = (value >> 8) & 0xFF;
    this.syncWorkingRegisterMirror();
  }

  private popFromStack(): number {
    const value = this.state.ram[this.state.registers.SP] || 0;
    this.state.registers.SP = (this.state.registers.SP - 1) & 0xFF; // Decrement SP, wrap around 256
    return value;
  }

  private popFromStack16(): number {
    // Pop high byte first
    const highByte = this.state.ram[this.state.registers.SP] || 0;
    this.state.registers.SP = (this.state.registers.SP - 1) & 0xFF;
    // Pop low byte
    const lowByte = this.state.ram[this.state.registers.SP] || 0;
    this.state.registers.SP = (this.state.registers.SP - 1) & 0xFF;
    return (highByte << 8) | lowByte;
  }

  private executeMOVC(operands: string[]): void {
    if (operands.length !== 2 || !operands[0] || operands[0].toUpperCase() !== 'A') {
      this.state.pc += 1;
      return;
    }
    const src = (operands[1] || '').toUpperCase().replace(/\s+/g, '');
    if (src === '@A+DPTR') {
      // MOVC A, @A+DPTR — read from code memory at DPTR + A
      const dptr = ((this.state.registers.DPH << 8) | this.state.registers.DPL) & 0xFFFF;
      const address = (this.state.registers.A + dptr) & 0xFFFF;
      this.state.registers.A = this.codeMemory[address];
    } else if (src === '@A+PC') {
      // MOVC A, @A+PC — read from code memory at PC + A + 1
      const address = (this.state.pc + 1 + this.state.registers.A) & 0xFFFF;
      this.state.registers.A = this.codeMemory[address];
    }
    this.updateParity();
    this.state.pc += 1;
  }

  private executeSJMP(operands: string[]): void {
    if (operands.length !== 1) {
      this.state.pc += 2; // SJMP is a 2-byte instruction
      return;
    }
    const targetLabel = operands[0];
    if (!targetLabel) {
      this.state.pc += 2;
      return;
    }
    const targetPC = this.labels.get(targetLabel);
    if (targetPC !== undefined) {
      this.state.pc = targetPC;
    } else {
      this.state.pc += 2; // SJMP is a 2-byte instruction
    }
  }

  private executeLJMP(operands: string[]): void {
    if (operands.length !== 1) {
      this.state.pc += 3; // LJMP is a 3-byte instruction
      return;
    }
    const targetLabel = operands[0];
    if (!targetLabel) {
      this.state.pc += 3;
      return;
    }
    const targetPC = this.labels.get(targetLabel);
    if (targetPC !== undefined) {
      this.state.pc = targetPC;
    } else {
      this.state.pc += 3; // LJMP is a 3-byte instruction
    }
  }

  private executeINC(operands: string[]): void {
    if (operands.length !== 1) {
      this.state.pc += 1;
      return;
    }
    const operand = (operands[0] || '').toUpperCase();

    // INC DPTR — 16-bit increment (1-byte, opcode A3)
    if (operand === 'DPTR') {
      let dptr = ((this.state.registers.DPH << 8) | this.state.registers.DPL) & 0xFFFF;
      dptr = (dptr + 1) & 0xFFFF;
      this.state.registers.DPH = (dptr >> 8) & 0xFF;
      this.state.registers.DPL = dptr & 0xFF;
      this.state.pc += 1;
      return;
    }

    let value = this.getValue(operands[0]);
    value = (value + 1) & 0xFF;
    this.setValue(operands[0], value);
    if (operand === 'A') this.updateParity();
    // INC A = 1 byte; INC Rn = 1 byte; INC @Ri = 1 byte; INC direct = 2 bytes
    this.state.pc += (operand === 'A' || operand.match(/^R[0-7]$/) || operand.match(/^@R[01]$/)) ? 1 : 2;
  }

  private executeDEC(operands: string[]): void {
    if (operands.length !== 1) {
      this.state.pc += 1;
      return;
    }
    const operand = (operands[0] || '').toUpperCase();
    let value = this.getValue(operands[0]);
    value = (value - 1) & 0xFF;
    this.setValue(operands[0], value);
    if (operand === 'A') this.updateParity();
    // DEC A = 1 byte; DEC Rn = 1 byte; DEC @Ri = 1 byte; DEC direct = 2 bytes
    this.state.pc += (operand === 'A' || operand.match(/^R[0-7]$/) || operand.match(/^@R[01]$/)) ? 1 : 2;
  }

  private executeJMP(operands: string[]): void {
    if (operands.length !== 1) {
      this.state.pc += 1;
      return;
    }
    const target = operands[0].toUpperCase();
    // JMP @A+DPTR — computed jump
    if (target === '@A+DPTR') {
      const a = this.state.registers.A || 0;
      const dptr = ((this.state.registers.DPH || 0) << 8) | (this.state.registers.DPL || 0);
      this.state.pc = (a + dptr) & 0xFFFF;
      return;
    }
    const targetPC = this.labels.get(target);
    if (targetPC !== undefined) {
      this.state.pc = targetPC;
    } else {
      this.state.pc += 1;
    }
  }

  private executeJZ(operands: string[]): void {
    if (operands.length !== 1) {
      this.state.pc += 2; // JZ is a 2-byte instruction
      return;
    }
    const targetLabel = operands[0];
    if (!targetLabel) {
      this.state.pc += 2;
      return;
    }
    if (this.state.registers.A === 0) {
      const targetPC = this.labels.get(targetLabel);
      if (targetPC !== undefined) {
        this.state.pc = targetPC;
      } else {
        this.state.pc += 2; // Advance if label not found
      }
    } else {
      this.state.pc += 2;
    }
  }

  private executeJNZ(operands: string[]): void {
    if (operands.length !== 1) {
      this.state.pc += 2; // JNZ is a 2-byte instruction
      return;
    }
    const targetLabel = operands[0];
    if (!targetLabel) {
      this.state.pc += 2;
      return;
    }
    if (this.state.registers.A !== 0) {
      const targetPC = this.labels.get(targetLabel);
      if (targetPC !== undefined) {
        this.state.pc = targetPC;
      } else {
        this.state.pc += 2; // Advance if label not found
      }
    } else {
      this.state.pc += 2;
    }
  }

  private executeJC(operands: string[]): void {
    if (operands.length !== 1) {
      this.state.pc += 2; // JC is a 2-byte instruction
      return;
    }
    const targetLabel = operands[0];
    if (!targetLabel) {
      this.state.pc += 2;
      return;
    }
    if (this.state.psw.CY) {
      const targetPC = this.labels.get(targetLabel);
      if (targetPC !== undefined) {
        this.state.pc = targetPC;
      } else {
        this.state.pc += 2; // Advance if label not found
      }
    } else {
      this.state.pc += 2;
    }
  }

  private executeJNC(operands: string[]): void {
    if (operands.length !== 1) {
      this.state.pc += 2; // JNC is a 2-byte instruction
      return;
    }
    const targetLabel = operands[0];
    if (!targetLabel) {
      this.state.pc += 2;
      return;
    }
    if (!this.state.psw.CY) {
      const targetPC = this.labels.get(targetLabel);
      if (targetPC !== undefined) {
        this.state.pc = targetPC;
      } else {
        this.state.pc += 2; // Advance if label not found
      }
    } else {
      this.state.pc += 2;
    }
  }

  private executeJB(operands: string[]): void {
    if (operands.length !== 2) { this.state.pc += 3; return; }
    const bitOperand = this.resolveSymbol(operands[0] || '').toUpperCase();
    const targetLabel = operands[1] || '';
    if (!bitOperand || !targetLabel) { this.state.pc += 3; return; }

    if (this.getBitValue(bitOperand)) {
      const targetPC = this.labels.get(targetLabel);
      this.state.pc = targetPC !== undefined ? targetPC : this.state.pc + 3;
    } else {
      this.state.pc += 3;
    }
  }

  private executeJNB(operands_raw: string[]): void {
    const operands = [...operands_raw];
    if (operands[0]) operands[0] = this.resolveSymbol(operands[0]);
    if (operands.length !== 2) { this.state.pc += 3; return; }
    const bitOperand = (operands[0] || '').toUpperCase();
    const targetLabel = operands[1] || '';
    if (!bitOperand || !targetLabel) { this.state.pc += 3; return; }

    if (!this.getBitValue(bitOperand)) {
      const targetPC = this.labels.get(targetLabel);
      this.state.pc = targetPC !== undefined ? targetPC : this.state.pc + 3;
    } else {
      this.state.pc += 3;
    }
  }

  /**
   * MOV 指令字节长度的唯一计算入口——解析期（地址分配）与执行期（PC 推进）共用。
   * 修复：此前两处各写一套判断，`MOV @Ri, A`（真实 1 字节）解析按 3 字节分配地址、
   * 执行只前进 1 字节，PC 落到指令缝隙里，"就近找指令"回退到同一条 MOV 反复执行，
   * 程序原地死循环；`MOV @Ri, direct`（真实 2 字节）同病。统一后与 8051 手册一致。
   */
  private getMovLength(destRaw: string, srcRaw: string): number {
    const dest = this.resolveSymbol(destRaw || '');
    const src = this.resolveSymbol(srcRaw || '');
    const d = dest.toUpperCase();
    const s = src.toUpperCase();
    // 位传送：MOV C,bit / MOV bit,C 均为 2 字节
    if ((d === 'C' || d === 'CY') && this.isBitOperand(src)) return 2;
    if (this.isBitOperand(dest) && (s === 'C' || s === 'CY')) return 2;
    if (d === 'DPTR') return 3; // MOV DPTR, #data16
    if (s.startsWith('#')) {
      // MOV A/Rn/@Ri, #data = 2；MOV direct, #data = 3
      return (d === 'A' || /^R[0-7]$/.test(d) || /^@R[01]$/.test(d)) ? 2 : 3;
    }
    if (d === 'A') return (/^R[0-7]$/.test(s) || /^@R[01]$/.test(s)) ? 1 : 2; // MOV A,Rn/@Ri=1；MOV A,direct=2
    if (/^R[0-7]$/.test(d) || /^@R[01]$/.test(d)) return s === 'A' ? 1 : 2;   // MOV Rn/@Ri,A=1；MOV Rn/@Ri,direct=2
    if (this.isDirectAddress(dest)) {
      if (s === 'A' || /^R[0-7]$/.test(s) || /^@R[01]$/.test(s)) return 2;    // MOV direct, A/Rn/@Ri
      return 3;                                                               // MOV direct, direct
    }
    return 2;
  }

  /** Calculate instruction length for ANL/ORL/XRL */
  private logicOpLength(dest: string, src: string): number {
    const d = dest.toUpperCase();
    const s = src.toUpperCase();
    if (d === 'A') {
      // ANL A, Rn = 1; ANL A, @Ri = 1; ANL A, #data = 2; ANL A, direct = 2
      return (s.match(/^R[0-7]$/i) || s.match(/^@R[01]$/i)) ? 1 : 2;
    }
    // ANL direct, A = 2; ANL direct, #data = 3
    return s.startsWith('#') ? 3 : 2;
  }

  private executeANL(operands: string[]): void {
    if (operands.length !== 2) { this.state.pc += 2; return; }
    const dest = operands[0] || '';
    const src = operands[1] || '';
    const du = dest.toUpperCase();
    // ANL C, bit / ANL C, /bit
    if (du === 'C' || du === 'CY') {
      const complement = src.startsWith('/');
      const bitSrc = complement ? src.substring(1) : src;
      let bitVal = this.getBitValue(bitSrc) ? 1 : 0;
      if (complement) bitVal = bitVal ? 0 : 1;
      this.state.psw.CY = this.state.psw.CY && bitVal ? true : false;
      this.state.pc += 2;
      return;
    }
    const value1 = this.getValue(dest);
    const value2 = this.getValue(src);
    this.setValue(dest, value1 & value2);
    if (du === 'A') this.updateParity();
    this.state.pc += this.logicOpLength(dest, src);
  }

  private executeORL(operands: string[]): void {
    if (operands.length !== 2) { this.state.pc += 2; return; }
    const dest = operands[0] || '';
    const src = operands[1] || '';
    const du = dest.toUpperCase();
    // ORL C, bit / ORL C, /bit
    if (du === 'C' || du === 'CY') {
      const complement = src.startsWith('/');
      const bitSrc = complement ? src.substring(1) : src;
      let bitVal = this.getBitValue(bitSrc) ? 1 : 0;
      if (complement) bitVal = bitVal ? 0 : 1;
      this.state.psw.CY = this.state.psw.CY || bitVal ? true : false;
      this.state.pc += 2;
      return;
    }
    const value1 = this.getValue(dest);
    const value2 = this.getValue(src);
    this.setValue(dest, value1 | value2);
    if (du === 'A') this.updateParity();
    this.state.pc += this.logicOpLength(dest, src);
  }

  private executeXRL(operands: string[]): void {
    if (operands.length !== 2) { this.state.pc += 2; return; }
    const dest = operands[0] || '';
    const src = operands[1] || '';
    const value1 = this.getValue(dest);
    const value2 = this.getValue(src);
    this.setValue(dest, value1 ^ value2);
    if (dest.toUpperCase() === 'A') this.updateParity();
    this.state.pc += this.logicOpLength(dest, src);
  }

  private executeRLC(operands: string[]): void {
    if (operands.length !== 1 || !operands[0] || operands[0].toUpperCase() !== 'A') {
      this.state.pc += 1; // RLC is a 1-byte instruction
      return;
    }
    let value = this.state.registers.A;
    const cy = this.state.psw.CY ? 1 : 0;
    this.state.psw.CY = (value & 0x80) !== 0; // Old bit 7 goes to CY
    value = ((value << 1) | cy) & 0xFF;
    this.state.registers.A = value;
    this.updateParity();
    this.state.pc += 1;
  }

  private executeRRC(operands: string[]): void {
    if (operands.length !== 1 || !operands[0] || operands[0].toUpperCase() !== 'A') {
      this.state.pc += 1; // RRC is a 1-byte instruction
      return;
    }
    let value = this.state.registers.A;
    const cy = this.state.psw.CY ? 1 : 0;
    this.state.psw.CY = (value & 0x01) !== 0; // Old bit 0 goes to CY
    value = (cy << 7) | (value >> 1);
    this.state.registers.A = value;
    this.updateParity();
    this.state.pc += 1;
  }

  private executeADD(operands: string[]): void {
    if (operands.length !== 2 || !operands[0] || operands[0].toUpperCase() !== 'A') {
      this.state.pc += 1;
      return;
    }
    const src = operands[1] || '';
    const srcValue = this.getValue(src);
    const result = this.state.registers.A + srcValue;
    this.state.psw.CY = result > 0xFF;
    this.state.psw.AC = ((this.state.registers.A & 0x0F) + (srcValue & 0x0F)) > 0x0F;
    this.state.psw.OV = ((this.state.registers.A ^ result) & (srcValue ^ result) & 0x80) !== 0;
    this.state.registers.A = result & 0xFF;
    this.updateParity();
    // ADD A, Rn = 1 byte; ADD A, @Ri = 1 byte; ADD A, #data = 2 bytes; ADD A, direct = 2 bytes
    const srcU = src.toUpperCase();
    this.state.pc += (srcU.match(/^R[0-7]$/i) || srcU.match(/^@R[01]$/i)) ? 1 : 2;
  }

  private executeADDC(operands: string[]): void {
    if (operands.length !== 2 || !operands[0] || operands[0].toUpperCase() !== 'A') {
      this.state.pc += 1;
      return;
    }
    const src = operands[1] || '';
    const srcValue = this.getValue(src);
    const cy = this.state.psw.CY ? 1 : 0;
    const result = this.state.registers.A + srcValue + cy;
    this.state.psw.CY = result > 0xFF;
    this.state.psw.AC = ((this.state.registers.A & 0x0F) + (srcValue & 0x0F) + cy) > 0x0F;
    this.state.psw.OV = ((this.state.registers.A ^ result) & (srcValue ^ result) & 0x80) !== 0;
    this.state.registers.A = result & 0xFF;
    this.updateParity();
    const srcU = src.toUpperCase();
    this.state.pc += (srcU.match(/^R[0-7]$/i) || srcU.match(/^@R[01]$/i)) ? 1 : 2;
  }

  private executeSUBB(operands: string[]): void {
    if (operands.length !== 2 || !operands[0] || operands[0].toUpperCase() !== 'A') {
      this.state.pc += 1;
      return;
    }
    const src = operands[1] || '';
    const srcValue = this.getValue(src);
    const cy = this.state.psw.CY ? 1 : 0;
    const result = this.state.registers.A - srcValue - cy;
    this.state.psw.CY = result < 0;
    this.state.psw.AC = ((this.state.registers.A & 0x0F) - (srcValue & 0x0F) - cy) < 0;
    this.state.psw.OV = ((this.state.registers.A ^ result) & (~srcValue ^ result) & 0x80) !== 0;
    this.state.registers.A = result & 0xFF;
    this.updateParity();
    const srcU = src.toUpperCase();
    this.state.pc += (srcU.match(/^R[0-7]$/i) || srcU.match(/^@R[01]$/i)) ? 1 : 2;
  }

  private executeDA(_operands: string[]): void {
    // DA A — decimal adjust accumulator after BCD addition
    // Accepts both "DA" and "DA A" formats
    let a = this.state.registers.A;
    let cy = this.state.psw.CY;
    if ((a & 0x0F) > 9 || this.state.psw.AC) {
      a += 6;
      if (a > 0xFF) cy = true;
    }
    if (((a >> 4) & 0x0F) > 9 || cy) {
      a += 0x60;
      if (a > 0xFF) cy = true;
    }
    this.state.psw.CY = cy;
    this.state.registers.A = a & 0xFF;
    this.updateParity();
    this.state.pc += 1;
  }

  private executeSWAP(operands: string[]): void {
    if (operands.length !== 1 || !operands[0] || operands[0].toUpperCase() !== 'A') {
      this.state.pc += 1; // SWAP is a 1-byte instruction
      return;
    }
    const a = this.state.registers.A;
    this.state.registers.A = ((a & 0x0F) << 4) | ((a & 0xF0) >> 4);
    this.updateParity();
    this.state.pc += 1;
  }

  private executeXCH(operands: string[]): void {
    if (operands.length !== 2 || !operands[0] || operands[0].toUpperCase() !== 'A') {
      this.state.pc += 1; // XCH is a 1-byte instruction (simplified)
      return;
    }
    const dest = operands[1];
    const valueA = this.state.registers.A;
    const valueDest = this.getValue(dest);
    this.state.registers.A = valueDest;
    this.setValue(dest, valueA);
    this.updateParity();
    const destUpper = (dest || '').toUpperCase();
    this.state.pc += (destUpper.match(/^R[0-7]$/) || destUpper.match(/^@R[01]$/)) ? 1 : 2;
  }

  private executeXCHD(operands: string[]): void {
    if (
      operands.length !== 2 ||
      !operands[0] ||
      operands[0].toUpperCase() !== 'A' ||
      !operands[1] ||
      !operands[1].match(/^@R[01]$/i)
    ) {
      this.state.pc += 1; // XCHD is a 1-byte instruction (simplified)
      return;
    }
    const dest = operands[1];
    const valueA = this.state.registers.A;
    const valueDest = this.getValue(dest);

    this.state.registers.A = (valueA & 0xF0) | (valueDest & 0x0F);
    this.setValue(dest, (valueDest & 0xF0) | (valueA & 0x0F));
    this.updateParity();
    this.state.pc += 1;
  }

  private executeLCALL(operands: string[]): void {
    if (operands.length !== 1) {
      this.state.pc += 3; // LCALL is a 3-byte instruction
      return;
    }
    const targetLabel = operands[0];
    if (!targetLabel) {
      this.state.pc += 3;
      return;
    }
    const targetPC = this.labels.get(targetLabel);
    if (targetPC !== undefined) {
      this.pushToStack16(this.state.pc + 3); // Push return address (PC + 3 for LCALL)
      this.state.pc = targetPC;
    } else {
      this.state.pc += 3; // Advance if label not found
    }
  }

  private executeAJMP(operands: string[]): void {
    if (operands.length !== 1) {
      this.state.pc += 2; // AJMP is a 2-byte instruction
      return;
    }
    const targetLabel = operands[0];
    if (!targetLabel) {
      this.state.pc += 2;
      return;
    }
    const targetPC = this.labels.get(targetLabel);
    if (targetPC !== undefined) {
      this.state.pc = targetPC;
    } else {
      this.state.pc += 2; // Advance if label not found
    }
  }

  private executeEND(): void {
    this.state.terminated = true;
  }

  /** RETI — return from interrupt: pop PC 并解除中断态，允许后续中断再次派发 */
  private executeRETI(): void {
    this.inInterrupt = false; // 重新允许中断响应（本简化模型不支持嵌套）
    this.executeRET(); // Pop PC from stack, same behavior as RET
  }

  /** JBC bit, rel — jump if bit set AND clear bit (3 bytes) */
  private executeJBC(operands: string[]): void {
    if (operands.length !== 2) { this.state.pc += 3; return; }
    const bitOp = this.resolveSymbol(operands[0] || '').toUpperCase();
    const targetLabel = operands[1] || '';
    const bitValue = this.getBitValue(bitOp);
    if (bitValue) {
      this.setBitValue(bitOp, false); // Clear the bit
      const targetPC = this.labels.get(targetLabel);
      this.state.pc = targetPC !== undefined ? targetPC : this.state.pc + 3;
    } else {
      this.state.pc += 3;
    }
  }

  /**
   * MOVX — 外部数据存储器访问（1 字节指令）。
   * 修复：此前写外部 RAM 是空操作、读恒返回 0xFF，MOVX 往返（写→读回）不可验证。
   * 现在 @DPTR 按 16 位地址访问 xram；@Ri 与真实 8051 一致，高 8 位取 P2、低 8 位取 Ri。
   * 未写过的单元仍读 0xFF（总线悬空），保持既有"未连接"语义与存量用例兼容。
   */
  private executeMOVX(operands: string[]): void {
    if (operands.length !== 2) { this.state.pc += 1; return; }
    const dest = (operands[0] || '').toUpperCase().replace(/\s+/g, '');
    const src = (operands[1] || '').toUpperCase().replace(/\s+/g, '');
    const dptr = (((this.state.registers.DPH || 0) << 8) | (this.state.registers.DPL || 0)) & 0xFFFF;
    if (dest === 'A' && src === '@DPTR') {
      // MOVX A, @DPTR — 读外部 RAM
      this.state.registers.A = this.xram[dptr];
      this.updateParity();
    } else if (dest === 'A' && (src === '@R0' || src === '@R1')) {
      // MOVX A, @Ri — 8 位地址 + P2 页地址
      const lo = this.getWorkingRegisterValue(src.substring(1));
      this.state.registers.A = this.xram[((this.state.portValues.P2 << 8) | lo) & 0xFFFF];
      this.updateParity();
    } else if (dest === '@DPTR' && src === 'A') {
      // MOVX @DPTR, A — 写外部 RAM
      this.xram[dptr] = this.state.registers.A & 0xFF;
    } else if ((dest === '@R0' || dest === '@R1') && src === 'A') {
      // MOVX @Ri, A — 写外部 RAM（P2 页地址）
      const lo = this.getWorkingRegisterValue(dest.substring(1));
      this.xram[((this.state.portValues.P2 << 8) | lo) & 0xFFFF] = this.state.registers.A & 0xFF;
    }
    this.state.pc += 1;
  }

  private executeMUL(operands: string[]): void {
    if (operands.length !== 1 || !operands[0] || operands[0].toUpperCase() !== 'AB') {
      this.state.pc += 1; // MUL is a 1-byte instruction
      return;
    }
    const result = this.state.registers.A * this.state.registers.B;
    this.state.registers.A = result & 0xFF; // Low byte
    this.state.registers.B = (result >> 8) & 0xFF; // High byte
    this.state.psw.CY = false; // CY is always cleared
    this.state.psw.OV = result > 0xFF; // OV is set if result > 255
    this.updateParity();
    this.state.pc += 1;
  }

  private executeDIV(operands: string[]): void {
    if (operands.length !== 1 || !operands[0] || operands[0].toUpperCase() !== 'AB') {
      this.state.pc += 1; // DIV is a 1-byte instruction
      return;
    }
    if (this.state.registers.B === 0) {
      // Division by zero
      this.state.psw.OV = true; // Set overflow flag
      this.state.psw.CY = false; // CY is cleared
      // A and B remain unchanged in case of division by zero
    } else {
      const quotient = Math.floor(this.state.registers.A / this.state.registers.B);
      const remainder = this.state.registers.A % this.state.registers.B;
      this.state.registers.A = quotient & 0xFF;
      this.state.registers.B = remainder & 0xFF;
      this.state.psw.OV = false; // Clear overflow flag
      this.state.psw.CY = false; // CY is always cleared
    }
    this.updateParity();
    this.state.pc += 1;
  }

  public getState(): SimulatorState {
    // 返回当前状态的深拷贝，避免外部直接修改内部状态
    const snapshot = JSON.parse(JSON.stringify(this.state)) as SimulatorState;
    // 修复：JSON 序列化会把 Uint8Array 退化成普通对象（丢失 length 与数组语义），
    // 内存面板拿到后 ram.length 为 undefined，所有单元恒读 0——即"内存面板一潭死水"的根源。
    // 这里必须还原成真正的 Uint8Array。
    snapshot.ram = Uint8Array.from(this.state.ram);
    // 动态补齐 memory，以免因深拷贝缺失导致 undefined
    snapshot.memory = this.instructions.map(i => `${i.mnemonic} ${i.operands.join(' ')}`.trim());
    // 计算当前 PC 对应的源代码行号
    const currentInstr = this.instructions.find(i => i.address === this.state.pc);
    snapshot.currentLine = currentInstr ? currentInstr.line : -1;
    return snapshot;
  }



  /**
   * 全速执行程序，直到到达程序尾、出现 Terminate 标志或达到最大步数。
   * @param maxSteps   防御性限制，避免陷入死循环
   * @returns          执行完毕后整理的监控数据，供 UI 直接渲染
   */
  public simulate(maxSteps: number = 50000) {
    let steps = 0;
    const pcHistory: number[] = [];
    const loopDetectionWindow = 100; // 检测循环的窗口大小

    while (!this.state.terminated && steps < maxSteps) {
      // 检查当前PC是否有对应的指令
      if (!this.instructionMap.has(this.state.pc)) {
        // 如果PC超出了有效指令范围，程序应该终止
        const maxAddress = Math.max(...Array.from(this.instructionMap.keys()));
        if (this.state.pc > maxAddress || this.instructionMap.size === 0) {
          console.log(`程序执行完成，PC: ${this.state.pc.toString(16).toUpperCase()}H，总执行步数: ${steps}`);
          this.state.terminated = true;
          break;
        }
      }

      // 记录PC历史用于循环检测
      pcHistory.push(this.state.pc);
      if (pcHistory.length > loopDetectionWindow) {
        pcHistory.shift();
      }

      // 循环检测：在足够多步后，检测是否形成了完整的重复周期
      // 这允许 DJNZ 等短循环正常执行，只检测宏观上的无限重复
      if (steps > 500 && pcHistory.length >= loopDetectionWindow) {
        // 检测方法：比较最近 N 步和之前 N 步是否完全相同（周期重复）
        const halfLen = Math.floor(pcHistory.length / 2);
        const recent = pcHistory.slice(-halfLen);
        const previous = pcHistory.slice(-halfLen * 2, -halfLen);
        if (recent.length === previous.length && recent.every((pc, i) => pc === previous[i])) {
          console.log(`检测到完整重复周期（${halfLen}步），程序稳态运行，终止仿真。总步数: ${steps}`);
          this.state.terminated = true;
          break;
        }
      }

      this.step();
      steps++;

      // 如果step()执行后程序被标记为终止，也应该退出循环
      if (this.state.terminated) {
        console.log(`程序遇到END指令或其他终止条件，总执行步数: ${steps}`);
        break;
      }
    }

    // 如果达到最大步数限制
    if (steps >= maxSteps) {
      console.warn(`程序执行达到最大步数限制 (${maxSteps})，可能存在死循环`);
      this.state.terminated = true;
    }

    // 将 P1 口的值转换成 LED 点亮模式（低电平点亮）
    const ledPattern = this.getLedPatternFromPort(this.state.portValues.P1);

    return {
      registers: { ...this.state.registers },
      portValues: {
        P0: '0x' + this.state.portValues.P0.toString(16).toUpperCase().padStart(2, '0'),
        P1: '0x' + this.state.portValues.P1.toString(16).toUpperCase().padStart(2, '0'),
        P2: '0x' + this.state.portValues.P2.toString(16).toUpperCase().padStart(2, '0'),
        P3: '0x' + this.state.portValues.P3.toString(16).toUpperCase().padStart(2, '0'),
      },
      leds: ledPattern,
      psw: { ...this.state.psw },
    };
  }

  // 根据 P1 端口值生成 LED 点亮布尔数组（低电平点亮）
  private getLedPatternFromPort(portValue: number): boolean[] {
    const pattern: boolean[] = [];
    for (let i = 0; i < 8; i++) {
      // 低电平(0) 表示灯亮
      pattern.push(((portValue >> i) & 1) === 0);
    }
    return pattern;
  }
}
