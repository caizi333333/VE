; 历史备课候选源文件；不是已核实的本班最终实验程序。
; 源路径：2025实验-丸子/s1/EG2.asm
; 仅统一编码和换行；未修订指令或核验实物效果。
 ;实验1-例2
		ORG 0000H
		LJMP HEXASC
		ORG 0030H
HEXASC: MOV A,#58H
		MOV 30H,#7FH
		MOV P1,#0EAH
		MOV SP,#40H
		PUSH ACC
		PUSH 30H
		MOV A,P1
		MOV 30H,A
		POP 30H
		POP ACC
		RET
		END
