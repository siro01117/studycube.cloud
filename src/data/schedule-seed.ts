// 2026년 7월 학생 스케줄표(엑셀) 파싱 결과 — DB 최초 이관용 1회성 시드.
// 이관이 끝나면 DB 가 원본이며 이 파일은 지워도 된다.
export type SeedItem = { kind: "study" | "academy"; reason: string; days: number[]; start: number; end: number };
export type SeedStudent = { sheet: string; seat: number; name: string; items: SeedItem[] };
export const SCHEDULE_SEED: { students: SeedStudent[]; warnings: { sheet: string; seat: number; name: string; line: string; why: string }[] } = {
  "students": [
    {
      "sheet": "5-1",
      "seat": 1,
      "name": "강윤우",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            3,
            4
          ],
          "start": 480,
          "end": 1320
        },
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            2,
            5
          ],
          "start": 480,
          "end": 1020
        }
      ]
    },
    {
      "sheet": "5-1",
      "seat": 6,
      "name": "조휘서",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            5
          ],
          "start": 480,
          "end": 1380
        },
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            4
          ],
          "start": 480,
          "end": 1260
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 1320,
          "end": 1410
        }
      ]
    },
    {
      "sheet": "5-1",
      "seat": 11,
      "name": "정도원",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 480,
          "end": 1380
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 1140,
          "end": 1260
        }
      ]
    },
    {
      "sheet": "5-1",
      "seat": 17,
      "name": "고유원",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 570,
          "end": 1380
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            1
          ],
          "start": 1110,
          "end": 1200
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            3
          ],
          "start": 540,
          "end": 630
        }
      ]
    },
    {
      "sheet": "5-1",
      "seat": 23,
      "name": "김범준",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 495,
          "end": 1320
        }
      ]
    },
    {
      "sheet": "5-1",
      "seat": 2,
      "name": "여우현",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 480,
          "end": 1380
        }
      ]
    },
    {
      "sheet": "5-1",
      "seat": 7,
      "name": "김범준",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 480,
          "end": 1380
        }
      ]
    },
    {
      "sheet": "5-1",
      "seat": 12,
      "name": "한상훈",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 480,
          "end": 1380
        }
      ]
    },
    {
      "sheet": "5-1",
      "seat": 18,
      "name": "김민재",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            3
          ],
          "start": 480,
          "end": 1080
        },
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            2
          ],
          "start": 480,
          "end": 1290
        },
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            4,
            5
          ],
          "start": 480,
          "end": 720
        }
      ]
    },
    {
      "sheet": "5-1",
      "seat": 24,
      "name": "장신범",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 500,
          "end": 1310
        }
      ]
    },
    {
      "sheet": "5-1",
      "seat": 3,
      "name": "장성현",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            3
          ],
          "start": 1140,
          "end": 1260
        },
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            2
          ],
          "start": 1140,
          "end": 1320
        },
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            4
          ],
          "start": 1170,
          "end": 1320
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            1,
            3
          ],
          "start": 1080,
          "end": 1200
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            4
          ],
          "start": 1020,
          "end": 1110
        }
      ]
    },
    {
      "sheet": "5-1",
      "seat": 8,
      "name": "최민기",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 510,
          "end": 1390
        }
      ]
    },
    {
      "sheet": "5-1",
      "seat": 13,
      "name": "정지원",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 480,
          "end": 1380
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 1260,
          "end": 1380
        }
      ]
    },
    {
      "sheet": "5-1",
      "seat": 19,
      "name": "노승윤",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 510,
          "end": 1380
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            3
          ],
          "start": 1200,
          "end": 1440
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            5
          ],
          "start": 1200,
          "end": 1380
        }
      ]
    },
    {
      "sheet": "5-1",
      "seat": 9,
      "name": "장우주",
      "items": []
    },
    {
      "sheet": "5-1",
      "seat": 14,
      "name": "장현성",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 540,
          "end": 1380
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            1,
            3
          ],
          "start": 660,
          "end": 810
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            2
          ],
          "start": 1020,
          "end": 1170
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            4
          ],
          "start": 1200,
          "end": 1290
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            5
          ],
          "start": 1290,
          "end": 1410
        }
      ]
    },
    {
      "sheet": "5-1",
      "seat": 20,
      "name": "이동균",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 510,
          "end": 1220
        }
      ]
    },
    {
      "sheet": "5-1",
      "seat": 26,
      "name": "박서준",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            4,
            5
          ],
          "start": 540,
          "end": 1020
        },
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            3
          ],
          "start": 540,
          "end": 960
        }
      ]
    },
    {
      "sheet": "5-1",
      "seat": 5,
      "name": "권진욱",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 780,
          "end": 1350
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            1
          ],
          "start": 960,
          "end": 1110
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            5
          ],
          "start": 990,
          "end": 1140
        }
      ]
    },
    {
      "sheet": "5-1",
      "seat": 10,
      "name": "김세호",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 480,
          "end": 1305
        }
      ]
    },
    {
      "sheet": "5-1",
      "seat": 15,
      "name": "최우찬",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            5
          ],
          "start": 490,
          "end": 1110
        },
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            2,
            3,
            4
          ],
          "start": 490,
          "end": 1380
        }
      ]
    },
    {
      "sheet": "5-1",
      "seat": 21,
      "name": "유정진",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 510,
          "end": 1170
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 1200,
          "end": 1320
        }
      ]
    },
    {
      "sheet": "5-1",
      "seat": 27,
      "name": "정현진",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 540,
          "end": 1380
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            1,
            3
          ],
          "start": 660,
          "end": 810
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            2
          ],
          "start": 1020,
          "end": 1410
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            4
          ],
          "start": 1200,
          "end": 1290
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            5
          ],
          "start": 1290,
          "end": 1410
        }
      ]
    },
    {
      "sheet": "5-1",
      "seat": 22,
      "name": "이의준",
      "items": []
    },
    {
      "sheet": "5-2",
      "seat": 38,
      "name": "석도원",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 520,
          "end": 1350
        }
      ]
    },
    {
      "sheet": "5-2",
      "seat": 31,
      "name": "안준석",
      "items": []
    },
    {
      "sheet": "5-2",
      "seat": 51,
      "name": "홍지승",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 540,
          "end": 1500
        }
      ]
    },
    {
      "sheet": "5-2",
      "seat": 39,
      "name": "박규민",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 480,
          "end": 1380
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 1140,
          "end": 1380
        }
      ]
    },
    {
      "sheet": "5-2",
      "seat": 32,
      "name": "임나영",
      "items": []
    },
    {
      "sheet": "5-2",
      "seat": 52,
      "name": "백창준",
      "items": []
    },
    {
      "sheet": "5-2",
      "seat": 40,
      "name": "김지안",
      "items": []
    },
    {
      "sheet": "5-2",
      "seat": 33,
      "name": "윤승현",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 510,
          "end": 1380
        }
      ]
    },
    {
      "sheet": "5-2",
      "seat": 41,
      "name": "박진우",
      "items": []
    },
    {
      "sheet": "5-2",
      "seat": 34,
      "name": "박지후",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            4
          ],
          "start": 780,
          "end": 1380
        },
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            3
          ],
          "start": 780,
          "end": 1260
        },
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            5
          ],
          "start": 780,
          "end": 1200
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            1
          ],
          "start": 780,
          "end": 930
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            3
          ],
          "start": 1050,
          "end": 1170
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            4
          ],
          "start": 960,
          "end": 1140
        }
      ]
    },
    {
      "sheet": "5-2",
      "seat": 42,
      "name": "강동훈",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 480,
          "end": 1380
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            2
          ],
          "start": 1260,
          "end": 1380
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            4
          ],
          "start": 1140,
          "end": 1260
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            5
          ],
          "start": 1290,
          "end": 1380
        }
      ]
    },
    {
      "sheet": "5-2",
      "seat": 35,
      "name": "김환수",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 480,
          "end": 1305
        }
      ]
    },
    {
      "sheet": "5-2",
      "seat": 55,
      "name": "김희진",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 510,
          "end": 1320
        }
      ]
    },
    {
      "sheet": "5-2",
      "seat": 43,
      "name": "홍채원",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 480,
          "end": 1410
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            3
          ],
          "start": 660,
          "end": 840
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            4
          ],
          "start": 540,
          "end": 720
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            5
          ],
          "start": 660,
          "end": 840
        }
      ]
    },
    {
      "sheet": "5-2",
      "seat": 36,
      "name": "최준호",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 480,
          "end": 1380
        }
      ]
    },
    {
      "sheet": "5-2",
      "seat": 44,
      "name": "박건호",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 480,
          "end": 1320
        }
      ]
    },
    {
      "sheet": "5-2",
      "seat": 37,
      "name": "이은서",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 510,
          "end": 1380
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            1
          ],
          "start": 1110,
          "end": 1170
        }
      ]
    },
    {
      "sheet": "4-3",
      "seat": 158,
      "name": "전아영",
      "items": []
    },
    {
      "sheet": "4-3",
      "seat": 149,
      "name": "한은호",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            4
          ],
          "start": 480,
          "end": 1220
        },
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            2,
            3,
            5
          ],
          "start": 480,
          "end": 1305
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            1,
            4
          ],
          "start": 1290,
          "end": 1380
        }
      ]
    },
    {
      "sheet": "4-3",
      "seat": 144,
      "name": "조채원",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            4
          ],
          "start": 480,
          "end": 1320
        },
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            2,
            3,
            5
          ],
          "start": 480,
          "end": 1380
        }
      ]
    },
    {
      "sheet": "4-3",
      "seat": 143,
      "name": "유채원",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 480,
          "end": 1380
        }
      ]
    },
    {
      "sheet": "4-3",
      "seat": 157,
      "name": "장주은",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 520,
          "end": 1305
        }
      ]
    },
    {
      "sheet": "4-3",
      "seat": 150,
      "name": "김소예",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 520,
          "end": 1400
        }
      ]
    },
    {
      "sheet": "4-3",
      "seat": 145,
      "name": "안예인",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 480,
          "end": 1380
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            3
          ],
          "start": 690,
          "end": 990
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            5
          ],
          "start": 1230,
          "end": 1380
        }
      ]
    },
    {
      "sheet": "4-3",
      "seat": 142,
      "name": "김도연",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 540,
          "end": 1305
        }
      ]
    },
    {
      "sheet": "4-3",
      "seat": 156,
      "name": "한정민",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 480,
          "end": 1380
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            5
          ],
          "start": 1200,
          "end": 1380
        }
      ]
    },
    {
      "sheet": "4-3",
      "seat": 151,
      "name": "오채원",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 540,
          "end": 1350
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            3,
            5
          ],
          "start": 1170,
          "end": 1380
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            7
          ],
          "start": 1170,
          "end": 1290
        }
      ]
    },
    {
      "sheet": "4-3",
      "seat": 146,
      "name": "남유주",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 480,
          "end": 1380
        }
      ]
    },
    {
      "sheet": "4-3",
      "seat": 141,
      "name": "오주원",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            4,
            5
          ],
          "start": 480,
          "end": 1380
        },
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            3
          ],
          "start": 480,
          "end": 1080
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            2,
            4
          ],
          "start": 1110,
          "end": 1290
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            3
          ],
          "start": 1140,
          "end": 1320
        }
      ]
    },
    {
      "sheet": "4-3",
      "seat": 155,
      "name": "고정경",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 520,
          "end": 1380
        }
      ]
    },
    {
      "sheet": "4-3",
      "seat": 152,
      "name": "김가현",
      "items": []
    },
    {
      "sheet": "4-3",
      "seat": 147,
      "name": "김지율",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 480,
          "end": 1320
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            1,
            3,
            5
          ],
          "start": 960,
          "end": 1080
        }
      ]
    },
    {
      "sheet": "4-3",
      "seat": 140,
      "name": "최윤아",
      "items": []
    },
    {
      "sheet": "4-3",
      "seat": 154,
      "name": "김주경",
      "items": []
    },
    {
      "sheet": "4-3",
      "seat": 153,
      "name": "송현민",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            3,
            5
          ],
          "start": 640,
          "end": 1380
        },
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            2
          ],
          "start": 480,
          "end": 1190
        },
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            4
          ],
          "start": 480,
          "end": 1070
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            1
          ],
          "start": 840,
          "end": 1020
        }
      ]
    },
    {
      "sheet": "4-3",
      "seat": 148,
      "name": "박민정",
      "items": []
    },
    {
      "sheet": "4-3",
      "seat": 139,
      "name": "권유진",
      "items": []
    },
    {
      "sheet": "4-1, 2",
      "seat": 119,
      "name": "최민주",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 780,
          "end": 1440
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            1,
            2,
            3,
            5
          ],
          "start": 960,
          "end": 1080
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            4
          ],
          "start": 960,
          "end": 1380
        }
      ]
    },
    {
      "sheet": "4-1, 2",
      "seat": 118,
      "name": "김지후",
      "items": []
    },
    {
      "sheet": "4-1, 2",
      "seat": 107,
      "name": "김세현",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1
          ],
          "start": 480,
          "end": 1080
        },
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            2
          ],
          "start": 480,
          "end": 920
        },
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            3,
            5
          ],
          "start": 480,
          "end": 1200
        },
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            4
          ],
          "start": 480,
          "end": 720
        }
      ]
    },
    {
      "sheet": "4-1, 2",
      "seat": 106,
      "name": "김지윤",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            4,
            5
          ],
          "start": 520,
          "end": 1380
        },
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            2
          ],
          "start": 520,
          "end": 1270
        },
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            3
          ],
          "start": 520,
          "end": 1180
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            1
          ],
          "start": 1020,
          "end": 1110
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            4
          ],
          "start": 1110,
          "end": 1200
        }
      ]
    },
    {
      "sheet": "4-1, 2",
      "seat": 120,
      "name": "나한나",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 510,
          "end": 1260
        }
      ]
    },
    {
      "sheet": "4-1, 2",
      "seat": 117,
      "name": "김하니",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            4
          ],
          "start": 450,
          "end": 1310
        },
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            3
          ],
          "start": 450,
          "end": 1080
        },
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            5
          ],
          "start": 450,
          "end": 1065
        }
      ]
    },
    {
      "sheet": "4-1, 2",
      "seat": 108,
      "name": "조아영",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 660,
          "end": 1260
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            2,
            4
          ],
          "start": 810,
          "end": 900
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            3
          ],
          "start": 840,
          "end": 960
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            5
          ],
          "start": 1140,
          "end": 1260
        }
      ]
    },
    {
      "sheet": "4-1, 2",
      "seat": 105,
      "name": "이다인",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 480,
          "end": 1380
        }
      ]
    },
    {
      "sheet": "4-1, 2",
      "seat": 121,
      "name": "박정아",
      "items": []
    },
    {
      "sheet": "4-1, 2",
      "seat": 116,
      "name": "공미정",
      "items": []
    },
    {
      "sheet": "4-1, 2",
      "seat": 109,
      "name": "지은서",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 535,
          "end": 1305
        }
      ]
    },
    {
      "sheet": "4-1, 2",
      "seat": 104,
      "name": "김윤아",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 480,
          "end": 1380
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            1,
            3
          ],
          "start": 1080,
          "end": 1290
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            2,
            4
          ],
          "start": 990,
          "end": 1260
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            5
          ],
          "start": 900,
          "end": 1080
        }
      ]
    },
    {
      "sheet": "4-1, 2",
      "seat": 122,
      "name": "김다영",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            3
          ],
          "start": 600,
          "end": 890
        },
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            2,
            4
          ],
          "start": 600,
          "end": 1260
        },
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            5
          ],
          "start": 600,
          "end": 960
        }
      ]
    },
    {
      "sheet": "4-1, 2",
      "seat": 115,
      "name": "이영주",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 510,
          "end": 1305
        }
      ]
    },
    {
      "sheet": "4-1, 2",
      "seat": 110,
      "name": "김다엘",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 480,
          "end": 1380
        }
      ]
    },
    {
      "sheet": "4-1, 2",
      "seat": 103,
      "name": "박건영",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            3,
            5
          ],
          "start": 480,
          "end": 1380
        },
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            2
          ],
          "start": 480,
          "end": 870
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            1
          ],
          "start": 960,
          "end": 1080
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            4
          ],
          "start": 1140,
          "end": 1320
        }
      ]
    },
    {
      "sheet": "4-1, 2",
      "seat": 123,
      "name": "정은재",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            5
          ],
          "start": 465,
          "end": 1230
        },
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            2,
            3,
            4
          ],
          "start": 465,
          "end": 1380
        }
      ]
    },
    {
      "sheet": "4-1, 2",
      "seat": 114,
      "name": "김가민",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 540,
          "end": 1380
        }
      ]
    },
    {
      "sheet": "4-1, 2",
      "seat": 111,
      "name": "강보민",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            3
          ],
          "start": 1140,
          "end": 1400
        },
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            2
          ],
          "start": 1230,
          "end": 1400
        },
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            5
          ],
          "start": 1140,
          "end": 1400
        }
      ]
    },
    {
      "sheet": "4-1, 2",
      "seat": 102,
      "name": "심다해",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 630,
          "end": 1260
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            2
          ],
          "start": 1140,
          "end": 1260
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            3
          ],
          "start": 840,
          "end": 960
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            3
          ],
          "start": 1140,
          "end": 1260
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            5
          ],
          "start": 840,
          "end": 960
        },
        {
          "kind": "academy",
          "reason": "외부 학원",
          "days": [
            5
          ],
          "start": 1140,
          "end": 1260
        }
      ]
    },
    {
      "sheet": "4-1, 2",
      "seat": 113,
      "name": "박서현",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 480,
          "end": 1305
        }
      ]
    },
    {
      "sheet": "4-1, 2",
      "seat": 112,
      "name": "박보정",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            3,
            5
          ],
          "start": 480,
          "end": 1380
        },
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            2,
            4
          ],
          "start": 480,
          "end": 1080
        }
      ]
    },
    {
      "sheet": "4-1, 2",
      "seat": 101,
      "name": "문소연",
      "items": [
        {
          "kind": "study",
          "reason": "자습",
          "days": [
            1,
            2,
            3,
            4,
            5
          ],
          "start": 480,
          "end": 1305
        }
      ]
    }
  ],
  "warnings": [
    {
      "sheet": "5-1",
      "seat": 13,
      "name": "정지원",
      "line": " (불규칙적인 학원 시간)",
      "why": "괄호 안 자유 서술/불규칙 표기라 파싱 대상에서 제외"
    },
    {
      "sheet": "5-1",
      "seat": 9,
      "name": "장우주",
      "line": "",
      "why": "헤더는 있으나 본문(스케줄 텍스트)이 비어 있음"
    },
    {
      "sheet": "5-1",
      "seat": 5,
      "name": "권진욱",
      "line": "수 17:00-16:00",
      "why": "자정 넘김 처리 시 비현실적인 값(시작 17:00, 종료 16:00 -> 익일 처리 시 비정상)"
    },
    {
      "sheet": "5-1",
      "seat": 10,
      "name": "김세호",
      "line": "수학과외 요일변도있음",
      "why": "시간 형식이 아니어서 파싱 불가(구간: '수학과외 요일변도있음')"
    },
    {
      "sheet": "5-1",
      "seat": 22,
      "name": "이의준",
      "line": "",
      "why": "헤더는 있으나 본문(스케줄 텍스트)이 비어 있음"
    },
    {
      "sheet": "5-2",
      "seat": 31,
      "name": "안준석",
      "line": "",
      "why": "헤더는 있으나 본문(스케줄 텍스트)이 비어 있음"
    },
    {
      "sheet": "5-2",
      "seat": 32,
      "name": "임나영",
      "line": "",
      "why": "헤더는 있으나 본문(스케줄 텍스트)이 비어 있음"
    },
    {
      "sheet": "5-2",
      "seat": 52,
      "name": "백창준",
      "line": "",
      "why": "헤더는 있으나 본문(스케줄 텍스트)이 비어 있음"
    },
    {
      "sheet": "5-2",
      "seat": 40,
      "name": "김지안",
      "line": "",
      "why": "헤더는 있으나 본문(스케줄 텍스트)이 비어 있음"
    },
    {
      "sheet": "5-2",
      "seat": 41,
      "name": "박진우",
      "line": "8-23(`~)",
      "why": "괄호 안 자유 서술/불규칙 표기라 파싱 대상에서 제외"
    },
    {
      "sheet": "5-2",
      "seat": 43,
      "name": "홍채원",
      "line": "타학원 (국어 맨날 다름)",
      "why": "괄호 안 자유 서술/불규칙 표기라 파싱 대상에서 제외"
    },
    {
      "sheet": "4-3",
      "seat": 158,
      "name": "전아영",
      "line": "",
      "why": "헤더는 있으나 본문(스케줄 텍스트)이 비어 있음"
    },
    {
      "sheet": "4-3",
      "seat": 152,
      "name": "김가현",
      "line": "",
      "why": "헤더는 있으나 본문(스케줄 텍스트)이 비어 있음"
    },
    {
      "sheet": "4-3",
      "seat": 140,
      "name": "최윤아",
      "line": "08:88-21:50",
      "why": "시작 시각 값 이상(토큰: '08:88-21:50')"
    },
    {
      "sheet": "4-3",
      "seat": 154,
      "name": "김주경",
      "line": "",
      "why": "헤더는 있으나 본문(스케줄 텍스트)이 비어 있음"
    },
    {
      "sheet": "4-3",
      "seat": 148,
      "name": "박민정",
      "line": "",
      "why": "헤더는 있으나 본문(스케줄 텍스트)이 비어 있음"
    },
    {
      "sheet": "4-3",
      "seat": 139,
      "name": "권유진",
      "line": "",
      "why": "헤더는 있으나 본문(스케줄 텍스트)이 비어 있음"
    },
    {
      "sheet": "4-1, 2",
      "seat": 118,
      "name": "김지후",
      "line": "",
      "why": "헤더는 있으나 본문(스케줄 텍스트)이 비어 있음"
    },
    {
      "sheet": "4-1, 2",
      "seat": 121,
      "name": "박정아",
      "line": "",
      "why": "헤더는 있으나 본문(스케줄 텍스트)이 비어 있음"
    },
    {
      "sheet": "4-1, 2",
      "seat": 116,
      "name": "공미정",
      "line": "",
      "why": "헤더는 있으나 본문(스케줄 텍스트)이 비어 있음"
    },
    {
      "sheet": "4-1, 2",
      "seat": 111,
      "name": "강보민",
      "line": "목 22:00-11:20",
      "why": "자정 넘김 처리 시 비현실적인 값(시작 22:00, 종료 11:20 -> 익일 처리 시 비정상)"
    }
  ]
};
