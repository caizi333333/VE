; 历史备课候选源文件；不是已核实的本班最终实验程序。
; 源路径：2025实验-丸子/S3/SHIYAN1.ASM
; 仅统一编码和换行；未修订指令或核验实物效果。
ORG 0000H
LJMP MAIN

ORG 000BH
LJMP DVT0

ORG 0040H
MAIN:
	MOV TMOD,#01H
	MOV TH0,#0B1H
    MOV TL0,#0E0H
    MOV R7,#50
    SETB ET0
    SETB EA
    SETB TR0
    SJMP $

DVT0:
	DJNZ R7,NT0
    MOV  R7,#50
    CPL  P0.0
NT0:
	MOV  TH0,#0B1H
    MOV  TL0,#0E0H
    ;SETB TR0
    RETI
END
