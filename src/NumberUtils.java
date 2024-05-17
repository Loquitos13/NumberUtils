import java.lang.*;
import java.util.*;
class ModaResultado {
    private static List<Double> moda;
    private int freqMaxima;
    public ModaResultado(List<Double> moda, int freqMaxima) {
        this.moda = moda;
        this.freqMaxima = freqMaxima;
    }
    public static List<Double> getModa() {
        return moda;
    }
    public int getFreqMaxima() {
        return freqMaxima;
    }
}
public class NumberUtils {
    //metodo para calcular a média dos X números indicados pelo utilizador
    public static double calcularMedia(List<Double> numeros) {
        double soma = 0;
        for (Double num : numeros) {
            soma += num;
        }
        return soma / numeros.size();
    }
    //metodo para calcular a mediana (número do meio da sequência)
    public static double calcularMediana(List<Double> numeros) {
        List<Double> listaNumeros = new ArrayList<>(numeros);
        int numeroMeio = listaNumeros.size() / 2;
        if (listaNumeros.size() % 2 == 0) { // se a quantidade de numeros inseridos for par
            // os dois números do meio da sequência somam e divide-se por 2
            return (listaNumeros.get(numeroMeio - 1) + listaNumeros.get(numeroMeio)) / 2;
        } else {
            //caso contrário (caso seja uma quantidade ímpar de números), é o número a meio da sequência
            return listaNumeros.get(numeroMeio);
        }
    }
    public static ModaResultado calcularModa(List<Double> numeros) {
        if (numeros.isEmpty()) return new ModaResultado(new ArrayList<>(), 0);
        Map<Double, Integer> frequenciaNumero = new HashMap<>();
        for (Double num : numeros) {
            frequenciaNumero.put(num, frequenciaNumero.getOrDefault(num, 0) + 1);
        }

        int freqMaxima = Collections.max(frequenciaNumero.values());
        List<Double> moda = new ArrayList<>();
        if (freqMaxima >= 2) {
            for (Map.Entry<Double, Integer> entry : frequenciaNumero.entrySet()) {
                if (entry.getValue() == freqMaxima) {
                    moda.add(entry.getKey());
                }
            }
        }
        return new ModaResultado(moda, freqMaxima);
    }
    public static void ordenarLista(List<Double> numeros, boolean crescente) {
        if (crescente) {
            Collections.sort(numeros);
        } else {
            Collections.sort(numeros, Collections.reverseOrder());
        }
    }
}



